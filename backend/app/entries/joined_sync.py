import logging
from typing import Any
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import KPI, KPIField, KPIEntry, KPIFieldValue, FieldType, utc_now
from app.entries.load_joined import load_joined_multi_line_rows, load_joined_scalar_values
from app.entries.routes import _replace_multi_line_rows_from_dicts
from app.kpis.service import sync_joined_kpi_fields

logger = logging.getLogger(__name__)


async def sync_joined_kpi_physical_data(
    db: AsyncSession,
    joined_kpi: KPI,
    year: int | None = None,
    period_key: str | None = None,
    current_user_id: int | None = None,
) -> int:
    """
    Physically synchronizes Joined KPI data into relational database tables:
    - Creates/updates KPIEntry for each relevant year/period
    - Materializes multi-line items into kpi_multi_line_rows and kpi_multi_line_cells
    - Materializes scalar field values into kpi_field_values
    
    Returns total rows materialized across all entries and multi-line fields.
    """
    if not joined_kpi or not getattr(joined_kpi, "is_joined", False):
        return 0

    config = getattr(joined_kpi, "joined_config", None) or {}
    mappings = config.get("mappings", [])
    if not mappings:
        return 0

    # Ensure field & subfield definitions exist
    await sync_joined_kpi_fields(db, joined_kpi)

    # Reload KPI with fields and subfields
    kpi_res = await db.execute(
        select(KPI)
        .where(KPI.id == joined_kpi.id)
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi_obj = kpi_res.scalar_one_or_none() or joined_kpi

    # Gather source KPI IDs to determine relevant (year, period_key) combinations
    source_kpi_ids: set[int] = set()
    for m in mappings:
        pkpi = m.get("primary_kpi_id")
        if pkpi:
            source_kpi_ids.add(int(pkpi))
        for j in m.get("joins", []):
            jkpi = j.get("kpi_id")
            if jkpi:
                source_kpi_ids.add(int(jkpi))
        for s in m.get("sources", []):
            skpi = s.get("kpi_id")
            if skpi:
                source_kpi_ids.add(int(skpi))

    if not source_kpi_ids:
        return 0

    # Determine targets (year, period_key)
    target_periods: set[tuple[int, str]] = set()
    if year is not None:
        target_periods.add((int(year), (period_key or "").strip()))
    else:
        # Discover all existing entries in source KPIs
        source_entries_res = await db.execute(
            select(KPIEntry.year, KPIEntry.period_key)
            .where(
                KPIEntry.kpi_id.in_(list(source_kpi_ids)),
                KPIEntry.organization_id == kpi_obj.organization_id,
                KPIEntry.is_draft == False,
            )
            .distinct()
        )
        for yr, pk in source_entries_res.all():
            target_periods.add((int(yr), (pk or "").strip()))

    if not target_periods:
        # Default to current year if no source entries found yet
        current_yr = utc_now().year
        target_periods.add((current_yr, ""))

    total_synced_rows = 0

    fields_by_key = {f.key: f for f in (kpi_obj.fields or [])}

    for yr, pk in target_periods:
        # Find or create KPIEntry for Joined KPI
        entry_res = await db.execute(
            select(KPIEntry).where(
                KPIEntry.kpi_id == kpi_obj.id,
                KPIEntry.organization_id == kpi_obj.organization_id,
                KPIEntry.year == yr,
                KPIEntry.period_key == pk,
            )
        )
        entry = entry_res.scalar_one_or_none()
        if not entry:
            try:
                async with db.begin_nested():
                    entry = KPIEntry(
                        kpi_id=kpi_obj.id,
                        organization_id=kpi_obj.organization_id,
                        year=yr,
                        period_key=pk,
                        is_draft=False,
                    )
                    db.add(entry)
                    await db.flush()
            except Exception:
                entry_res = await db.execute(
                    select(KPIEntry).where(
                        KPIEntry.kpi_id == kpi_obj.id,
                        KPIEntry.organization_id == kpi_obj.organization_id,
                        KPIEntry.year == yr,
                        KPIEntry.period_key == pk,
                    )
                )
                entry = entry_res.scalar_one_or_none()

        if not entry:
            continue

        # 1. Synchronize Multi-Line Fields
        for m in mappings:
            f_key = m.get("joined_field_key")
            field_obj = fields_by_key.get(f_key)
            if not field_obj:
                continue

            field_obj.kpi = kpi_obj

            if field_obj.field_type == FieldType.multi_line_items:
                combined_rows = await load_joined_multi_line_rows(
                    db,
                    joined_field=field_obj,
                    organization_id=kpi_obj.organization_id,
                    year=yr,
                    period_key=pk,
                    current_user_id=current_user_id,
                )

                # Persist directly into kpi_multi_line_rows and kpi_multi_line_cells
                await _replace_multi_line_rows_from_dicts(
                    db,
                    entry_id=entry.id,
                    field=field_obj,
                    rows=combined_rows,
                )
                total_synced_rows += len(combined_rows)

        # 2. Synchronize Scalar Fields
        scalar_fvs = await load_joined_scalar_values(
            db,
            joined_kpi=kpi_obj,
            entry_id=entry.id,
            current_user_id=current_user_id,
        )
        if scalar_fvs:
            for sfv in scalar_fvs:
                # Upsert into KPIFieldValue
                existing_fv_res = await db.execute(
                    select(KPIFieldValue).where(
                        KPIFieldValue.entry_id == entry.id,
                        KPIFieldValue.field_id == sfv.field_id,
                    )
                )
                existing_fv = existing_fv_res.scalar_one_or_none()
                if existing_fv:
                    existing_fv.value_text = sfv.value_text
                    existing_fv.value_number = sfv.value_number
                    existing_fv.value_json = sfv.value_json
                    existing_fv.value_boolean = sfv.value_boolean
                    existing_fv.value_date = sfv.value_date
                    existing_fv.updated_at = utc_now()
                else:
                    new_fv = KPIFieldValue(
                        entry_id=entry.id,
                        field_id=sfv.field_id,
                        value_text=sfv.value_text,
                        value_number=sfv.value_number,
                        value_json=sfv.value_json,
                        value_boolean=sfv.value_boolean,
                        value_date=sfv.value_date,
                    )
                    db.add(new_fv)

        entry.updated_at = utc_now()
        await db.flush()

    return total_synced_rows


async def trigger_dependent_joined_kpi_sync(
    db: AsyncSession,
    source_kpi_id: int,
    year: int | None = None,
    period_key: str | None = None,
) -> int:
    """
    Finds all Joined KPIs that depend on source_kpi_id and synchronizes their physical data.
    """
    joined_kpis_res = await db.execute(
        select(KPI).where(KPI.is_joined == True)
    )
    all_joined = joined_kpis_res.scalars().all()
    affected_count = 0

    for jkpi in all_joined:
        cfg = getattr(jkpi, "joined_config", None) or {}
        mappings = cfg.get("mappings", [])
        references_source = False
        for m in mappings:
            if m.get("primary_kpi_id") == source_kpi_id:
                references_source = True
                break
            for j in m.get("joins", []):
                if j.get("kpi_id") == source_kpi_id:
                    references_source = True
                    break
            for s in m.get("sources", []):
                if s.get("kpi_id") == source_kpi_id:
                    references_source = True
                    break
            if references_source:
                break

        if references_source:
            try:
                await sync_joined_kpi_physical_data(db, jkpi, year=year, period_key=period_key)
                affected_count += 1
            except Exception as ex:
                logger.error(f"Error synchronizing dependent joined KPI {jkpi.id}: {ex}")

    return affected_count

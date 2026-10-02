"""Service logic for the Join Multi-Line Items (MLI) Wizard.

Supports:
1. mode="create_new": Creates a new 3rd Joined (Virtual) KPI combining KPI 1 and KPI 2.
2. mode="enrich_existing": Attaches dynamic virtual lookup columns from KPI 2 directly to KPI 1 (or vice versa).
"""

from __future__ import annotations

import re
import logging
from typing import Any
from fastapi import HTTPException, status
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import (
    User,
    KPI,
    KPIField,
    KPIFieldSubField,
    FieldType,
    KpiMultiLineRow,
    KpiMultiLineCell,
)
from app.kpis.schemas import JoinMliWizardRequest, JoinMliWizardResponse
from app.kpis.service import sync_joined_kpi_fields
from app.widget_data.service import get_entry_id_updated, get_field_with_subfields_only

logger = logging.getLogger(__name__)

SLUG_PATTERN = re.compile(r"^[a-z0-9_]+$")


def _sanitize_slug(s: str) -> str:
    cleaned = re.sub(r"[^a-z0-9_]", "_", s.strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "col"


async def execute_join_mli_wizard(
    db: AsyncSession,
    current_user: User,
    req: JoinMliWizardRequest,
) -> JoinMliWizardResponse:
    """Validates and executes the Join MLI Wizard request."""
    # 1. Fetch both source KPIs
    kpi1_res = await db.execute(
        select(KPI)
        .where(KPI.id == req.kpi1_id)
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi1 = kpi1_res.scalar_one_or_none()
    if not kpi1:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source KPI 1 with ID {req.kpi1_id} not found",
        )

    kpi2_res = await db.execute(
        select(KPI)
        .where(KPI.id == req.kpi2_id)
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi2 = kpi2_res.scalar_one_or_none()
    if not kpi2:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source KPI 2 with ID {req.kpi2_id} not found",
        )

    # Permission check: both KPIs must be in the user's organization (unless Super Admin)
    role_str = (current_user.role or "").upper()
    is_super = role_str == "SUPER_ADMIN"
    if not is_super:
        if kpi1.organization_id != current_user.organization_id or kpi2.organization_id != current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot join KPIs across different organizations or unauthorized scopes",
            )

    # 2. Locate the two MLI fields
    f1 = next((f for f in (kpi1.fields or []) if f.key == req.kpi1_field_key), None)
    if not f1 or f1.field_type != FieldType.multi_line_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Field '{req.kpi1_field_key}' on KPI 1 is not a valid Multi-Line Item field",
        )

    f2 = next((f for f in (kpi2.fields or []) if f.key == req.kpi2_field_key), None)
    if not f2 or f2.field_type != FieldType.multi_line_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Field '{req.kpi2_field_key}' on KPI 2 is not a valid Multi-Line Item field",
        )

    # 3. Verify join keys exist
    f1_subkeys = {sf.key for sf in (f1.sub_fields or [])}
    if req.join_key_kpi1 not in f1_subkeys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Join key '{req.join_key_kpi1}' does not exist on KPI 1 field '{f1.name}'",
        )

    f2_subkeys = {sf.key for sf in (f2.sub_fields or [])}
    if req.join_key_kpi2 not in f2_subkeys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Join key '{req.join_key_kpi2}' does not exist on KPI 2 field '{f2.name}'",
        )

    # 4. Validate column alias slugs & uniqueness
    all_alias_keys: set[str] = set()
    for col in req.kpi1_columns + req.kpi2_columns:
        if not col.alias_key or not SLUG_PATTERN.match(col.alias_key):
            col.alias_key = _sanitize_slug(col.alias_key or col.source_key)
        if col.alias_key in all_alias_keys:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Duplicate column key '{col.alias_key}'. All resulting column keys must be unique.",
            )
        all_alias_keys.add(col.alias_key)

    # MODE A: CREATE A NEW 3RD JOINED (VIRTUAL) KPI
    if req.mode == "create_new":
        new_kpi_name = (req.new_kpi_name or f"{kpi1.name} & {kpi2.name} (Joined)").strip()
        new_field_name = (req.new_kpi_field_name or f"{f1.name} + {f2.name}").strip()
        new_field_key = _sanitize_slug(new_field_name)

        # Primary subfields aliases
        primary_col_aliases = {
            c.source_key: {
                "key": c.alias_key,
                "name": c.alias_name or c.source_key,
                "field_type": c.field_type or "single_line_text",
            }
            for c in req.kpi1_columns
        }
        joined_col_aliases = {
            c.source_key: {
                "key": c.alias_key,
                "name": c.alias_name or c.source_key,
                "field_type": c.field_type or "single_line_text",
            }
            for c in req.kpi2_columns
        }

        # Find which key is used as join key on primary in the output
        left_output_key = primary_col_aliases.get(req.join_key_kpi1, {}).get("key", req.join_key_kpi1)

        joined_config = {
            "mappings": [
                {
                    "joined_field_key": new_field_key,
                    "joined_field_name": new_field_name,
                    "field_type": "multi_line_items",
                    "primary_kpi_id": kpi1.id,
                    "primary_field_key": f1.key,
                    "primary_sub_field_keys": [c.source_key for c in req.kpi1_columns],
                    "primary_column_aliases": primary_col_aliases,
                    "joins": [
                        {
                            "kpi_id": kpi2.id,
                            "source_field_key": f2.key,
                            "on_left_sub_field_key": left_output_key,
                            "on_right_sub_field_key": req.join_key_kpi2,
                            "sub_field_keys": [c.source_key for c in req.kpi2_columns],
                            "column_aliases": joined_col_aliases,
                        }
                    ],
                }
            ]
        }

        next_sort_res = await db.execute(
            select(func.coalesce(func.max(KPI.sort_order), -1)).where(KPI.organization_id == kpi1.organization_id)
        )
        next_sort = next_sort_res.scalar_one() + 1
        new_kpi = KPI(
            organization_id=kpi1.organization_id,
            domain_id=req.domain_id or kpi1.domain_id,
            name=new_kpi_name,
            description=f"Joined Virtual KPI created from '{kpi1.name}' and '{kpi2.name}'",
            sort_order=next_sort,
            is_joined=True,
            joined_config=joined_config,
        )
        db.add(new_kpi)
        await db.flush()

        # Synchronize virtual fields and subfields for the new KPI
        await sync_joined_kpi_fields(db, new_kpi)
        await db.commit()

        return JoinMliWizardResponse(
            success=True,
            mode="create_new",
            kpi_id=new_kpi.id,
            field_key=new_field_key,
            message=f"Created Joined KPI '{new_kpi.name}' successfully.",
            kpi_name=new_kpi.name,
        )

    # MODE B: ENRICH AN EXISTING KPI
    elif req.mode == "enrich_existing":
        target_kpi_id = req.target_kpi_id or kpi1.id
        if target_kpi_id not in (kpi1.id, kpi2.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Target KPI ID {target_kpi_id} must be either KPI 1 ({kpi1.id}) or KPI 2 ({kpi2.id})",
            )

        if target_kpi_id == kpi1.id:
            target_kpi = kpi1
            target_field = f1
            source_kpi = kpi2
            source_field = f2
            left_key = req.join_key_kpi1
            right_key = req.join_key_kpi2
            columns_to_attach = req.kpi2_columns
        else:
            target_kpi = kpi2
            target_field = f2
            source_kpi = kpi1
            source_field = f1
            left_key = req.join_key_kpi2
            right_key = req.join_key_kpi1
            columns_to_attach = req.kpi1_columns

        # Ensure target_field.config has joined_columns
        f_cfg = dict(target_field.config or {})
        joined_cfg = dict(f_cfg.get("joined_columns") or {})
        existing_joins = list(joined_cfg.get("joins") or [])

        # Filter out existing join for this same source KPI and field
        updated_joins = [
            j for j in existing_joins
            if not (j.get("source_kpi_id") == source_kpi.id and j.get("source_field_key") == source_field.key)
        ]

        new_join_entry = {
            "source_kpi_id": source_kpi.id,
            "source_kpi_name": source_kpi.name,
            "source_field_key": source_field.key,
            "on_left_sub_field_key": left_key,
            "on_right_sub_field_key": right_key,
            "columns": [
                {
                    "source_key": c.source_key,
                    "alias_key": c.alias_key,
                    "alias_name": c.alias_name or c.source_key,
                    "field_type": c.field_type or "single_line_text",
                }
                for c in columns_to_attach
            ],
        }
        updated_joins.append(new_join_entry)
        joined_cfg["joins"] = updated_joins
        f_cfg["joined_columns"] = joined_cfg
        target_field.config = f_cfg
        await db.flush()

        # Synchronize virtual subfields for target_field
        await sync_field_virtual_columns(db, target_field)
        await db.commit()

        return JoinMliWizardResponse(
            success=True,
            mode="enrich_existing",
            kpi_id=target_kpi.id,
            field_key=target_field.key,
            message=f"Added {len(columns_to_attach)} dynamic joined column(s) from '{source_kpi.name}' into '{target_kpi.name}'.",
            kpi_name=target_kpi.name,
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown wizard mode '{req.mode}'. Use 'create_new' or 'enrich_existing'.",
        )


async def sync_field_virtual_columns(db: AsyncSession, field: KPIField) -> None:
    """Synchronizes virtual KPIFieldSubField rows on a regular KPIField based on field.config['joined_columns']."""
    f_cfg = getattr(field, "config", None) or {}
    joined_cfg = f_cfg.get("joined_columns") or {}
    joins = joined_cfg.get("joins") or []

    # Query existing subfields on this field
    sf_res = await db.execute(
        select(KPIFieldSubField).where(KPIFieldSubField.field_id == field.id)
    )
    existing_subfields = {sf.key: sf for sf in sf_res.scalars().all()}

    # Determine highest sort order of existing native subfields
    native_subfields = [sf for sf in existing_subfields.values() if not (sf.config or {}).get("is_virtual")]
    max_sort = max([sf.sort_order for sf in native_subfields], default=-1)

    active_virtual_keys: set[str] = set()
    current_sort = max_sort + 1

    for j in joins:
        source_kpi_id = j.get("source_kpi_id")
        source_field_key = j.get("source_field_key")
        for col in j.get("columns", []):
            alias_key = col.get("alias_key")
            alias_name = col.get("alias_name") or alias_key
            field_type_str = col.get("field_type", "single_line_text")
            source_key = col.get("source_key")

            active_virtual_keys.add(alias_key)

            try:
                ft_enum = FieldType(field_type_str)
            except ValueError:
                ft_enum = FieldType.single_line_text

            v_config = {
                "is_virtual": True,
                "read_only": True,
                "source_kpi_id": source_kpi_id,
                "source_field_key": source_field_key,
                "source_sub_field_key": source_key,
                "join_key_left": j.get("on_left_sub_field_key"),
                "join_key_right": j.get("on_right_sub_field_key"),
            }

            sf = existing_subfields.get(alias_key)
            if not sf:
                sf = KPIFieldSubField(
                    field_id=field.id,
                    key=alias_key,
                    name=alias_name,
                    field_type=ft_enum,
                    sort_order=current_sort,
                    config=v_config,
                )
                db.add(sf)
                current_sort += 1
            else:
                sf.name = alias_name
                sf.field_type = ft_enum
                sf_config = dict(sf.config or {})
                sf_config.update(v_config)
                sf.config = sf_config

    # Delete any obsolete virtual subfields that were removed from joins
    for k, sf in existing_subfields.items():
        is_virt = (sf.config or {}).get("is_virtual")
        if is_virt and k not in active_virtual_keys:
            await db.delete(sf)

    await db.flush()


async def apply_virtual_joined_columns(
    db: AsyncSession,
    *,
    field: KPIField,
    rows: list[tuple[int, dict[str, Any]]],
    organization_id: int,
    year: int,
    period_key: str = "",
    current_user_id: int | None = None,
) -> None:
    """Mutates in-place the row dicts in `rows` to attach dynamic lookup columns configured in field.config['joined_columns']."""
    f_cfg = getattr(field, "config", None) or {}
    joined_cfg = f_cfg.get("joined_columns") or {}
    joins = joined_cfg.get("joins") or []
    if not joins or not rows:
        return

    from app.entries.service import user_can_view_kpi

    for j in joins:
        src_kpi_id = j.get("source_kpi_id")
        src_field_key = j.get("source_field_key")
        left_key = str(j.get("on_left_sub_field_key") or "").strip()
        right_key = str(j.get("on_right_sub_field_key") or "").strip()
        columns = j.get("columns") or []
        if not src_kpi_id or not src_field_key or not left_key or not right_key or not columns:
            continue

        # Check permissions on source KPI
        if current_user_id is not None:
            if not await user_can_view_kpi(db, current_user_id, src_kpi_id, organization_id):
                continue

        # Collect distinct needed keys from rows
        needed = sorted({
            str(rw.get(left_key) or "").strip()
            for _, rw in rows
            if str(rw.get(left_key) or "").strip()
        })
        if not needed:
            # Still fill None for the columns
            for _, rw in rows:
                for col in columns:
                    rw.setdefault(col["alias_key"], None)
            continue

        # Resolve source field and entry
        jf_light = (
            await db.execute(
                select(KPIField).join(KPI, KPI.id == KPIField.kpi_id).where(
                    KPI.id == src_kpi_id,
                    KPI.organization_id == organization_id,
                    KPIField.key == src_field_key,
                    KPIField.field_type == "multi_line_items",
                )
            )
        ).scalars().first()
        if not jf_light:
            continue

        jf_obj = await get_field_with_subfields_only(db, int(jf_light.id), organization_id)
        jeid, _ = await get_entry_id_updated(db, org_id=organization_id, kpi_id=src_kpi_id, year=year, period_key=period_key)
        if not jf_obj or not jeid:
            for _, rw in rows:
                for col in columns:
                    rw.setdefault(col["alias_key"], None)
            continue

        jsf_by_key = {str(sf.key): sf for sf in jf_obj.sub_fields}
        right_sf = jsf_by_key.get(right_key)
        if not right_sf:
            continue

        jr = KpiMultiLineRow.__table__.alias("jr")
        jc = KpiMultiLineCell.__table__.alias("jc")

        needed_strs = set(needed)
        needed_nums = set()
        for x in needed:
            try:
                fval = float(x)
                needed_nums.add(fval)
                if fval.is_integer():
                    needed_strs.add(str(int(fval)))
                    needed_strs.add(f"{int(fval)}.0")
            except (ValueError, TypeError):
                pass

        key_expr = func.coalesce(
            func.nullif(func.trim(jc.c.value_text), ""),
            func.trim(func.to_char(jc.c.value_number, "FM9999999999990")),
        )

        conds = [key_expr.in_(list(needed_strs))]
        if needed_nums:
            conds.append(jc.c.value_number.in_(list(needed_nums)))
        if needed_strs:
            conds.append(jc.c.value_text.in_(list(needed_strs)))

        jbase = (
            select(func.min(jr.c.id).label("id"), func.min(jr.c.row_index).label("row_index"))
            .select_from(jr)
            .join(jc, and_(jc.c.row_id == jr.c.id, jc.c.sub_field_id == right_sf.id))
            .where(jr.c.entry_id == int(jeid), jr.c.field_id == int(jf_obj.id), or_(*conds))
            .group_by(key_expr)
        )
        jrows = list((await db.execute(jbase)).all())
        if not jrows:
            for _, rw in rows:
                for col in columns:
                    rw.setdefault(col["alias_key"], None)
            continue

        jrow_ids = [int(x[0]) for x in jrows]

        want_source_keys = [col["source_key"] for col in columns if col.get("source_key")]
        if right_key not in want_source_keys:
            want_source_keys.append(right_key)

        want_ids = [int(jsf_by_key[k].id) for k in want_source_keys if k in jsf_by_key]

        ctab = KpiMultiLineCell.__table__.alias("ctab")
        sftab = KPIFieldSubField.__table__.alias("sftab")

        jcell_res = await db.execute(
            select(
                ctab.c.row_id,
                sftab.c.key,
                ctab.c.value_text,
                ctab.c.value_number,
                ctab.c.value_boolean,
                ctab.c.value_date,
                ctab.c.value_json,
            )
            .select_from(ctab)
            .join(sftab, sftab.c.id == ctab.c.sub_field_id)
            .where(ctab.c.row_id.in_(jrow_ids), ctab.c.sub_field_id.in_(want_ids))
        )

        jidx_by_id = {int(rid): int(ridx) for rid, ridx in jrows}
        jrow_data: dict[int, dict[str, Any]] = {jidx_by_id[rid]: {} for rid in jrow_ids}
        for row_id, key2, vt, vn, vb, vd, vj in jcell_res.all():
            idx = jidx_by_id.get(int(row_id))
            if idx is None or not key2:
                continue
            if vj is not None:
                raw = vj
            elif vt is not None:
                raw = vt
            elif vn is not None:
                raw = vn
            elif vb is not None:
                raw = vb
            elif vd is not None:
                raw = vd
            else:
                raw = None
            jrow_data[idx][str(key2)] = raw

        def _clean_key(v: Any) -> str:
            s = str(v or "").strip()
            if s.endswith(".0"):
                return s[:-2]
            return s

        right_index = {}
        for idx, r_dict in jrow_data.items():
            raw_k = r_dict.get(right_key)
            if raw_k is not None:
                k_val = _clean_key(raw_k)
                if k_val and k_val.lower() not in ("none", "false"):
                    right_index[k_val] = r_dict

        # Merge values into each target row
        for _, row in rows:
            raw_k = row.get(left_key)
            matched = right_index.get(_clean_key(raw_k)) if raw_k is not None else None
            for col in columns:
                src_k = col["source_key"]
                alias_k = col["alias_key"]
                row[alias_k] = matched.get(src_k) if matched else None

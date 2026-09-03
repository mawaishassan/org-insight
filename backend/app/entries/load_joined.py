from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import KPI, KPIField, KPIEntry, KPIFieldValue
from app.entries.service import user_can_view_kpi

async def load_joined_multi_line_rows(
    db: AsyncSession,
    *,
    joined_field: KPIField,
    organization_id: int,
    year: int,
    period_key: str = "",
    current_user_id: int | None = None,
) -> list[dict]:
    """Dynamically fetch and combine Multi-Line Item rows from source KPIs according to joined_config mapping."""
    kpi = joined_field.kpi
    config = getattr(kpi, "joined_config", None) or {}
    
    # Locate mapping for this field key
    mapping = None
    for m in config.get("mappings", []):
        if m.get("joined_field_key") == joined_field.key:
            mapping = m
            break
            
    if not mapping or mapping.get("field_type") != "multi_line_items":
        return []
        
    combined_rows = []
    sources = mapping.get("sources", [])
    
    from app.entries.multi_line_load import load_multi_line_row_dicts
    
    primary_kpi_id = mapping.get("primary_kpi_id")
    primary_field_key = mapping.get("primary_field_key")
    if primary_kpi_id and primary_field_key:
        if current_user_id is not None:
            if not await user_can_view_kpi(db, current_user_id, primary_kpi_id, organization_id):
                return []
        src_field_res = await db.execute(
            select(KPIField)
            .where(KPIField.kpi_id == primary_kpi_id, KPIField.key == primary_field_key)
            .options(selectinload(KPIField.sub_fields))
        )
        src_field = src_field_res.scalar_one_or_none()
        if src_field:
            src_entry_res = await db.execute(
                select(KPIEntry).where(
                    KPIEntry.kpi_id == primary_kpi_id,
                    KPIEntry.organization_id == organization_id,
                    KPIEntry.year == year,
                    KPIEntry.period_key == period_key
                )
            )
            src_entry = src_entry_res.scalar_one_or_none()
            if src_entry:
                src_rows = await load_multi_line_row_dicts(db, entry_id=src_entry.id, field=src_field)
                psub_keys = mapping.get("primary_sub_field_keys")
                for _, r_data in src_rows:
                    if psub_keys is not None and len(psub_keys) > 0:
                        filtered = {k: v for k, v in r_data.items() if k in psub_keys}
                        combined_rows.append(filtered)
                    else:
                        combined_rows.append(r_data.copy())
    else:
        for src in sources:
            src_kpi_id = src.get("kpi_id")
            src_field_key = src.get("field_key")
            subfield_mappings = src.get("subfield_mappings", {})
            
            # Enforce user permission check
            if current_user_id is not None:
                if not await user_can_view_kpi(db, current_user_id, src_kpi_id, organization_id):
                    continue
                    
            # Resolve source KPI
            src_kpi_res = await db.execute(select(KPI).where(KPI.id == src_kpi_id))
            src_kpi = src_kpi_res.scalar_one_or_none()
            if not src_kpi:
                continue
                
            # Resolve source Field
            src_field_res = await db.execute(
                select(KPIField)
                .where(KPIField.kpi_id == src_kpi_id, KPIField.key == src_field_key)
                .options(selectinload(KPIField.sub_fields))
            )
            src_field = src_field_res.scalar_one_or_none()
            if not src_field:
                continue
                
            # Resolve source Entry
            src_entry_res = await db.execute(
                select(KPIEntry).where(
                    KPIEntry.kpi_id == src_kpi_id,
                    KPIEntry.organization_id == organization_id,
                    KPIEntry.year == year,
                    KPIEntry.period_key == period_key
                )
            )
            src_entry = src_entry_res.scalar_one_or_none()
            if not src_entry:
                continue
                
            # Load source row dicts
            src_rows = await load_multi_line_row_dicts(db, entry_id=src_entry.id, field=src_field)
            
            # Transform using subfield mapping
            for _, r_data in src_rows:
                transformed = {}
                for j_key, s_key in subfield_mappings.items():
                    if s_key in r_data:
                        transformed[j_key] = r_data[s_key]
                        
                combined_rows.append(transformed)
            
    # Apply key-based joins (if defined on the mapping/config)
    joins = mapping.get("joins") or config.get("joins") or []
    if joins and combined_rows:
        from sqlalchemy import and_, cast, String, func, or_
        from app.core.models import KPIFieldSubField, KpiMultiLineRow, KpiMultiLineCell
        from app.widget_data.service import get_entry_id_updated, get_field_with_subfields_only
        
        for j in joins:
            left_key = str(j.get("on_left_sub_field_key") or "").strip()
            right_key = str(j.get("on_right_sub_field_key") or "").strip()
            if not left_key or not right_key:
                continue
                
            needed = sorted({str(rw.get(left_key) or "").strip() for rw in combined_rows if str(rw.get(left_key) or "").strip()})
            if not needed:
                continue
                
            jkpi = int(j["kpi_id"])
            jsrc = str(j["source_field_key"])
            
            # Enforce user permission check
            if current_user_id is not None:
                if not await user_can_view_kpi(db, current_user_id, jkpi, organization_id):
                    continue
                    
            jf_light = (
                await db.execute(
                    select(KPIField).join(KPI, KPI.id == KPIField.kpi_id).where(
                        KPI.id == jkpi,
                        KPI.organization_id == organization_id,
                        KPIField.key == jsrc,
                        KPIField.field_type == "multi_line_items",
                    )
                )
            ).scalars().first()
            if not jf_light:
                continue
                
            jf_obj = await get_field_with_subfields_only(db, int(jf_light.id), organization_id)
            jeid, _je_ts = await get_entry_id_updated(db, org_id=organization_id, kpi_id=jkpi, year=year, period_key=period_key)
            if not jf_obj or not jeid:
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
                func.nullif(func.trim(jc.c.value_text), ''),
                func.trim(func.to_char(jc.c.value_number, 'FM9999999999990'))
            )

            conds = [key_expr.in_(list(needed_strs))]
            if needed_nums:
                conds.append(jc.c.value_number.in_(list(needed_nums)))
            if needed_strs:
                conds.append(jc.c.value_text.in_(list(needed_strs)))

            # Grouped query to match unique keys
            jbase = (
                select(func.min(jr.c.id).label("id"), func.min(jr.c.row_index).label("row_index"))
                .select_from(jr)
                .join(jc, and_(jc.c.row_id == jr.c.id, jc.c.sub_field_id == right_sf.id))
                .where(jr.c.entry_id == int(jeid), jr.c.field_id == int(jf_obj.id), or_(*conds))
                .group_by(key_expr)
            )
            jrows = list((await db.execute(jbase)).all())
            if not jrows:
                continue
                
            jrow_ids = [int(x[0]) for x in jrows]
            
            want_keys = [str(x) for x in (j.get("sub_field_keys") or []) if str(x).strip()]
            if want_keys:
                if right_key not in want_keys:
                    want_keys.append(right_key)
            else:
                want_keys = list(jsf_by_key.keys())
            want_ids = [int(jsf_by_key[k].id) for k in want_keys if k in jsf_by_key]
            
            ctab = KpiMultiLineCell.__table__.alias("ctab")
            sftab = KPIFieldSubField.__table__.alias("sftab")
            
            jcell_res = await db.execute(
                select(ctab.c.row_id, sftab.c.key, ctab.c.value_text, ctab.c.value_number, ctab.c.value_boolean, ctab.c.value_date, ctab.c.value_json)
                .select_from(ctab)
                .join(sftab, sftab.c.id == ctab.c.sub_field_id)
                .where(ctab.c.row_id.in_(jrow_ids), ctab.c.sub_field_id.in_(want_ids))
            )
            
            jidx_by_id = {int(rid): int(ridx) for rid, ridx in jrows}
            jrow_data = {jidx_by_id[rid]: {} for rid in jrow_ids}
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
                        
            for row in combined_rows:
                raw_k = row.get(left_key)
                matched = right_index.get(_clean_key(raw_k)) if raw_k is not None else None
                for wk in want_keys:
                    if wk != right_key:
                        row[wk] = matched.get(wk) if matched else None
                            
    return combined_rows


async def load_joined_scalar_values(
    db: AsyncSession,
    *,
    joined_kpi: KPI,
    entry_id: int,
    current_user_id: int | None = None,
) -> list[KPIFieldValue]:
    """Dynamically query and construct transient/virtual KPIFieldValue records for a Joined KPI."""
    entry_res = await db.execute(select(KPIEntry).where(KPIEntry.id == entry_id))
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return []
        
    config = getattr(joined_kpi, "joined_config", None) or {}
    mappings = config.get("mappings", [])
    
    joined_fields_by_key = {f.key: f for f in joined_kpi.fields}
    virtual_values = []
    
    for m in mappings:
        if m.get("field_type") == "multi_line_items":
            continue
            
        j_key = m.get("joined_field_key")
        src_kpi_id = m.get("source_kpi_id")
        src_field_key = m.get("source_field_key")
        
        j_field = joined_fields_by_key.get(j_key)
        if not j_field:
            continue
            
        # Check permissions
        if current_user_id is not None:
            if not await user_can_view_kpi(db, current_user_id, src_kpi_id, entry.organization_id):
                continue
                
        # Resolve source Field
        src_field_res = await db.execute(
            select(KPIField).where(KPIField.kpi_id == src_kpi_id, KPIField.key == src_field_key)
        )
        src_field = src_field_res.scalar_one_or_none()
        if not src_field:
            continue
            
        # Resolve source entry
        src_entry_res = await db.execute(
            select(KPIEntry).where(
                KPIEntry.kpi_id == src_kpi_id,
                KPIEntry.organization_id == entry.organization_id,
                KPIEntry.year == entry.year,
                KPIEntry.period_key == entry.period_key
            )
        )
        src_entry = src_entry_res.scalar_one_or_none()
        if not src_entry:
            continue
            
        # Query source KPIFieldValue
        fv_res = await db.execute(
            select(KPIFieldValue).where(
                KPIFieldValue.entry_id == src_entry.id,
                KPIFieldValue.field_id == src_field.id
            )
        )
        src_fv = fv_res.scalar_one_or_none()
        if src_fv:
            mock_fv = KPIFieldValue(
                id=src_fv.id + 50000000,
                entry_id=entry_id,
                field_id=j_field.id,
                value_text=src_fv.value_text,
                value_number=src_fv.value_number,
                value_json=src_fv.value_json,
                value_boolean=src_fv.value_boolean,
                value_date=src_fv.value_date
            )
            mock_fv.field = j_field
            mock_fv.entry = entry
            virtual_values.append(mock_fv)
            
    return virtual_values

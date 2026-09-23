import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User, CustomReport, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField, ReportUserFilterConfiguration, KPIField
from sqlalchemy import select, and_, or_, func

async def main():
    async with AsyncSessionLocal() as db:
        admin = (await db.execute(select(User).where(User.id == 1))).scalar_one_or_none()
        u110 = (await db.execute(select(User).where(User.id == 110))).scalar_one_or_none()

        print("=== Step A: Check ReportUserFilterConfiguration for Report 36 ===")
        filters = (await db.execute(
            select(ReportUserFilterConfiguration).where(ReportUserFilterConfiguration.report_id == 36)
        )).scalars().all()
        for f in filters:
            print(f"Filter ID {f.id}: report_id={f.report_id}, enabled={f.enabled}, kpi_id={f.kpi_id}, mli_id={f.mli_id}, field_id={f.field_id}, dynamic_value_source='{f.dynamic_value_source}'")

        print("\n=== Step B: Inspect KpiMultiLineRow query for KPIField 623 under User 110 ===")
        # KPIField 623
        kfield = (await db.execute(select(KPIField).where(KPIField.id == 623))).scalar_one_or_none()
        # KPIEntry for 277
        entry = (await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == 277, KPIEntry.year == 2026, KPIEntry.is_draft == False))).scalars().first()
        print(f"Entry ID {entry.id}")

        # 1. Unfiltered rows query (for admin)
        rows_stmt_admin = (
            select(KpiMultiLineRow)
            .where(
                KpiMultiLineRow.entry_id == entry.id,
                KpiMultiLineRow.field_id == kfield.id,
            )
            .order_by(KpiMultiLineRow.row_index)
        )
        rows_admin = (await db.execute(rows_stmt_admin)).scalars().all()
        print(f"Admin rows count: {len(rows_admin)}")
        for r in rows_admin:
            cells = (await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))).scalars().all()
            dept = ""
            fall_t = None
            for c in cells:
                if c.sub_field_id == 9063: # Department Name
                    dept = c.value_text
                elif c.sub_field_id == 9746: # Total Faculty Taught Fall 2025
                    fall_t = c.value_number
            if dept == "Mechanical Engineering":
                print(f"   Admin Mech row ID {r.id}: dept='{dept}', fall_t={fall_t}")

        # 2. Filtered rows query for User 110 (key='Mechanical Engineering')
        # Check what target_field_id is chosen by custom_service.py for User 110
        u_key = u110.unique_user_key
        print(f"\nUser 110 unique_user_key = '{u_key}'")

        # Trace lines 3584-3650 in custom_service.py
        filter_config = filters[0] if filters else None
        target_field_id = filter_config.field_id if filter_config else None
        if target_field_id is None:
            sf_res = await db.execute(
                select(KPIFieldSubField).where(KPIFieldSubField.field_id == kfield.id).order_by(KPIFieldSubField.id)
            )
            sfs = sf_res.scalars().all()
            for sf in sfs:
                k_norm = sf.key.lower()
                n_norm = (sf.name or "").lower()
                if any(dk in k_norm or dk in n_norm for dk in ("dept", "department", "user_key", "unique_key")):
                    target_field_id = sf.id
                    print(f"   Selected target_field_id = {sf.id} ('{sf.name}')")
                    break

        rows_stmt_u110 = (
            select(KpiMultiLineRow)
            .where(
                KpiMultiLineRow.entry_id == entry.id,
                KpiMultiLineRow.field_id == kfield.id,
            )
            .order_by(KpiMultiLineRow.row_index)
        )
        if target_field_id is not None:
            rows_stmt_u110 = rows_stmt_u110.join(
                KpiMultiLineCell,
                and_(
                    KpiMultiLineCell.row_id == KpiMultiLineRow.id,
                    KpiMultiLineCell.sub_field_id == target_field_id
                )
            )
            val_str = str(u_key).strip()
            variants = [val_str, f"Department of {val_str}", f"{val_str} Department"]
            conditions = []
            for v in variants:
                conditions.append(KpiMultiLineCell.value_text == v)
                conditions.append(func.lower(KpiMultiLineCell.value_text) == v.lower())
            rows_stmt_u110 = rows_stmt_u110.where(or_(*conditions))

        rows_u110 = (await db.execute(rows_stmt_u110)).scalars().all()
        print(f"User 110 filtered rows count: {len(rows_u110)}")
        for r in rows_u110:
            cells = (await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))).scalars().all()
            dept = ""
            fall_t = None
            fall_avg = None
            for c in cells:
                if c.sub_field_id == 9063: # Department Name
                    dept = c.value_text
                elif c.sub_field_id == 9746: # Total Faculty Taught Fall 2025
                    fall_t = c.value_number
                elif c.sub_field_id == 9751: # Average Score Fall 2025
                    fall_avg = c.value_number
            print(f"   User 110 Mech row ID {r.id}: dept='{dept}', fall_t={fall_t}, fall_avg={fall_avg}")

if __name__ == "__main__":
    asyncio.run(main())

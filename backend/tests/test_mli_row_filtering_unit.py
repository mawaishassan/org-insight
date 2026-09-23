import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    Organization,
    ReportTemplate,
    ReportAccessPermission,
    KPI,
    KPIField,
    KPIFieldSubField,
    KPIEntry,
    KpiMultiLineRow,
    KpiMultiLineCell,
    FieldType,
)
from app.reports.service import _load_multi_line_items_rows_batch


async def test_mli_row_filtering_unit():
    print("=== Testing MLI Row Filtering with Standard Report Permissions ===")
    async with AsyncSessionLocal() as db:
        # Create test KPI with an MLI field
        org = (await db.execute(select(Organization).limit(1))).scalar_one()

        test_user_cs = User(
            username="temp_cs_tester",
            hashed_password="x",
            role="USER",
            organization_id=org.id,
            unique_user_key="Computer Science",
        )
        db.add(test_user_cs)
        await db.flush()

        kpi = KPI(name="Unit Test MLI KPI", organization_id=org.id)
        db.add(kpi)
        await db.flush()

        mli_field = KPIField(
            kpi_id=kpi.id,
            name="Test Table",
            key="test_table",
            field_type=FieldType.multi_line_items,
        )
        db.add(mli_field)
        await db.flush()

        sf_dept = KPIFieldSubField(
            field_id=mli_field.id,
            name="Department",
            key="department",
            field_type=FieldType.single_line_text,
        )
        sf_val = KPIFieldSubField(
            field_id=mli_field.id,
            name="Score",
            key="score",
            field_type=FieldType.number,
        )
        db.add_all([sf_dept, sf_val])
        await db.flush()

        entry = KPIEntry(kpi_id=kpi.id, organization_id=org.id, year=2026)
        db.add(entry)
        await db.flush()

        # Row 1: Computer Science
        row1 = KpiMultiLineRow(entry_id=entry.id, field_id=mli_field.id, row_index=0)
        db.add(row1)
        await db.flush()
        c1_dept = KpiMultiLineCell(row_id=row1.id, sub_field_id=sf_dept.id, value_text="Computer Science")
        c1_score = KpiMultiLineCell(row_id=row1.id, sub_field_id=sf_val.id, value_number=95)
        db.add_all([c1_dept, c1_score])

        # Row 2: Electrical Engineering
        row2 = KpiMultiLineRow(entry_id=entry.id, field_id=mli_field.id, row_index=1)
        db.add(row2)
        await db.flush()
        c2_dept = KpiMultiLineCell(row_id=row2.id, sub_field_id=sf_dept.id, value_text="Electrical Engineering")
        c2_score = KpiMultiLineCell(row_id=row2.id, sub_field_id=sf_val.id, value_number=88)
        db.add_all([c2_dept, c2_score])

        await db.flush()

        # Create test ReportTemplate and ReportAccessPermission
        rt = ReportTemplate(name="Test RT", organization_id=org.id)
        db.add(rt)
        await db.flush()

        perm = ReportAccessPermission(
            report_template_id=rt.id,
            user_id=test_user_cs.id,
            can_view=True,
            can_use_unique_value=True,
            filter_sub_field_key="department",
        )
        db.add(perm)
        await db.flush()

        # 1. Load WITHOUT restriction (current_user=None) -> should return 2 rows
        full_batch = await _load_multi_line_items_rows_batch(
            db, entry_ids=[entry.id], field=mli_field, current_user=None
        )
        rows_full = full_batch.get(entry.id, [])
        print(f"Rows without restriction: {len(rows_full)} (Expected: 2)")
        assert len(rows_full) == 2, f"Expected 2 rows, got {len(rows_full)}"

        # 2. Load WITH unique key restriction (current_user=test_user_cs, template_perm=perm) -> should return 1 row (CS only!)
        filtered_batch = await _load_multi_line_items_rows_batch(
            db,
            entry_ids=[entry.id],
            field=mli_field,
            template_id=rt.id,
            template_perm=perm,
            current_user=test_user_cs,
        )
        rows_filtered = filtered_batch.get(entry.id, [])
        print(f"Rows with CS restriction: {len(rows_filtered)} (Expected: 1)")
        assert len(rows_filtered) == 1, f"Expected 1 row, got {len(rows_filtered)}"
        assert rows_filtered[0]["department"] == "Computer Science"
        assert rows_filtered[0]["score"] == 95
        print(f"Filtered Row Content: {rows_filtered[0]}")

        # 3. Test department normalization variants (e.g. user key has 'Department of Computer Science')
        test_user_cs.unique_user_key = "Department of Computer Science"
        await db.flush()
        norm_batch = await _load_multi_line_items_rows_batch(
            db,
            entry_ids=[entry.id],
            field=mli_field,
            template_id=rt.id,
            template_perm=perm,
            current_user=test_user_cs,
        )
        rows_norm = norm_batch.get(entry.id, [])
        print(f"Rows with 'Department of CS' normalized variant: {len(rows_norm)} (Expected: 1)")
        assert len(rows_norm) == 1
        assert rows_norm[0]["department"] == "Computer Science"

        # Rollback so no test junk remains in DB
        await db.rollback()
        print("\n=== ALL MLI ROW FILTERING TESTS PASSED [SUCCESS] ===")


if __name__ == "__main__":
    asyncio.run(test_mli_row_filtering_unit())

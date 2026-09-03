import asyncio
from app.core.database import AsyncSessionLocal
from app.core.models import KPIField, KPIEntry
from app.widget_data.service import (
    load_multi_line_row_dicts,
    _row_matches_specific_column_filter,
    _row_matches_normal_filters,
    recalculate_multi_line_rows_formulas,
    _apply_row_filters,
)
from sqlalchemy import select
from sqlalchemy.orm import selectinload

async def main():
    async with AsyncSessionLocal() as db:
        f_res = await db.execute(
            select(KPIField).where(
                KPIField.kpi_id == 278,
                KPIField.key == "qec_faculty_performance_faculty_wise"
            ).options(selectinload(KPIField.sub_fields))
        )
        field = f_res.scalar_one_or_none()
        entry_id = 401
        org_id = 3
        year = 2026
        column_filter = {
            "kpi_id": 273,
            "source_field_key": "qec_faculty_performance",
            "column_key": "semester",
            "column_name": "Semester",
            "value": "SPRING 2026"
        }
        raw_filters = {"_version": 2, "conditions": [{"field": "overall_score", "op": "neq", "value": "0"}]}

        # Step 1: load_multi_line_row_dicts
        pairs = await load_multi_line_row_dicts(db, entry_id=entry_id, field=field)
        rows = [d for _i, d in pairs if isinstance(d, dict)]
        print(f"Step 1: Loaded {len(rows)} raw stored rows from DB.")

        # Step 2: column_filter on rows
        rows_after_col = [r for r in rows if _row_matches_specific_column_filter(r, column_filter)]
        print(f"Step 2: Rows after _row_matches_specific_column_filter: {len(rows_after_col)}")

        # Step 3: recalculate formulas
        recalculated = await recalculate_multi_line_rows_formulas(
            db, org_id, year, field, rows_after_col, column_filter=column_filter
        )
        print(f"Step 3: Rows after recalculate_multi_line_rows_formulas: {len(recalculated)}")
        if recalculated:
            print("First 3 recalculated rows:")
            for r in recalculated[:3]:
                print("  faculty_id:", r.get("faculty_id"), "overall_score:", repr(r.get("overall_score")), "status:", repr(r.get("status")))

        # Step 4: _apply_row_filters
        final_filtered = await _apply_row_filters(db, org_id, field, year, raw_filters, recalculated)
        print(f"Step 4: Rows after _apply_row_filters: {len(final_filtered)}")

if __name__ == "__main__":
    asyncio.run(main())

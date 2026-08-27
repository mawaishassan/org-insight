import asyncio
import sys
import os
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField

async def main():
    async with AsyncSessionLocal() as db:
        # Load all entries for KPI 219
        entries_res = await db.execute(
            select(KPIEntry).where(
                KPIEntry.kpi_id == 219,
                KPIEntry.year == 2026
            )
        )
        entries = entries_res.scalars().all()
        
        entry_ids = [e.id for e in entries]
        if not entry_ids:
            print("No entries found")
            return
            
        # Load all multi-line rows for these entries
        rows_res = await db.execute(
            select(KpiMultiLineRow).where(
                KpiMultiLineRow.entry_id.in_(entry_ids)
            )
        )
        rows = rows_res.scalars().all()
        row_ids = [r.id for r in rows]
        
        # Load all cells for these rows
        cells_res = await db.execute(
            select(
                KpiMultiLineCell.row_id,
                KpiMultiLineCell.value_text,
                KpiMultiLineCell.value_number,
                KpiMultiLineCell.value_boolean,
                KpiMultiLineCell.value_date,
                KpiMultiLineCell.value_json,
                KPIFieldSubField.key
            )
            .join(KPIFieldSubField, KPIFieldSubField.id == KpiMultiLineCell.sub_field_id)
            .where(KpiMultiLineCell.row_id.in_(row_ids))
        )
        cells_list = cells_res.all()
        
        cells_by_row = defaultdict(dict)
        for row_id, vt, vn, vb, vd, vj, sf_key in cells_list:
            raw_val = None
            if vj is not None:
                raw_val = vj
            elif vt is not None:
                raw_val = vt
            elif vn is not None:
                raw_val = vn
            elif vb is not None:
                raw_val = vb
            elif vd is not None:
                try:
                    raw_val = vd.isoformat()
                except Exception:
                    raw_val = str(vd)
            cells_by_row[row_id][str(sf_key)] = raw_val
            
        # Count statuses
        statuses = {}
        matching_rows = []
        for r in rows:
            val = cells_by_row.get(r.id, {})
            status = val.get("status")
            statuses[status] = statuses.get(status, 0) + 1
            if status in ("Submission", "Not Awarded"):
                matching_rows.append(r)
                
        # Date range for fiscal year 2025/26
        import datetime
        start_date = datetime.date(2025, 7, 1)
        end_date = datetime.date(2026, 6, 30)
        
        date_filtered_rows = []
        for r in matching_rows:
            val = cells_by_row.get(r.id, {})
            row_date_str = val.get("proposal_submission_date")
            if row_date_str:
                try:
                    row_date = datetime.date.fromisoformat(row_date_str[:10])
                    if start_date <= row_date <= end_date:
                        date_filtered_rows.append((r, row_date, val))
                except Exception as e:
                    pass
                
        print(f"Total matching status: {len(matching_rows)}")
        print(f"Matching status and within fiscal year 2025/26 date range: {len(date_filtered_rows)}")
        
        # Let's inspect all date filtered rows
        print("\nDate Filtered Rows (all):")
        dept_counts = defaultdict(int)
        for r, d, val in date_filtered_rows:
            dept = val.get('department_id') or val.get('department_name')
            dept_counts[dept] += 1
            msg = f"- Row ID: {r.id}, Date: {d}, Department: {dept}, Faculty: {val.get('faculty_name')}"
            print(msg.encode('utf-8', 'ignore').decode('utf-8'))
            
        print("\nDepartment counts of date-filtered rows:")
        for dept, count in sorted(dept_counts.items(), key=lambda x: x[1], reverse=True):
            print(f"- {dept}: {count}")
            
        print(f"\nSum of department counts: {sum(dept_counts.values())}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.service import _load_multi_line_items_rows_batch
from app.core.models import KPIField, User

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)
        kfield = await db.get(KPIField, 624)
        print(f"kfield 624: key={kfield.key}, type={kfield.field_type}")

        # 1. Load without user
        res_no_user = await _load_multi_line_items_rows_batch(db, entry_ids=[401], field=kfield, custom_report_id=34, current_user=None)
        rows_no_user = res_no_user.get(401, [])
        print(f"\nTotal rows in Entry 401 WITHOUT user: {len(rows_no_user)}")
        
        # Check departments in rows
        depts = {}
        for r in rows_no_user:
            d = r.get("department")
            d_name = r.get("department_name")
            d_id = r.get("department_id")
            key = f"dept={d} | dept_name={d_name} | dept_id={d_id}"
            depts[key] = depts.get(key, 0) + 1
        
        print(f"\nUnique department keys in rows (total {len(depts)} groups):")
        for k, count in sorted(depts.items()):
            if "computer" in k.lower() or count > 50:
                print(f"  {k}: count={count}")

        # Let's count Fall and Spring for Computer Science
        cs_rows = [r for r in rows_no_user if any("computer" in str(v).lower() for v in (r.get("department"), r.get("department_name")))]
        print(f"\nComputer Science rows: {len(cs_rows)}")
        fall_cs = [r for r in cs_rows if float(r.get("total_survays_fall_2025") or 0) > 0]
        spring_cs = [r for r in cs_rows if float(r.get("total_survays_spring_2026") or 0) > 0]
        print(f"CS Fall Faculty (total_survays_fall_2025 > 0): {len(fall_cs)}")
        print(f"CS Spring Faculty (total_survays_spring_2026 > 0): {len(spring_cs)}")

        # 2. Now load WITH user_147 for Report 34
        res_rep34_u147 = await _load_multi_line_items_rows_batch(db, entry_ids=[401], field=kfield, custom_report_id=34, current_user=user_147)
        rows_rep34_u147 = res_rep34_u147.get(401, [])
        print(f"\nTotal rows in Entry 401 WITH user_147 for Report 34: {len(rows_rep34_u147)}")

        # 3. Now load WITH user_147 for Report 35
        res_rep35_u147 = await _load_multi_line_items_rows_batch(db, entry_ids=[401], field=kfield, custom_report_id=35, current_user=user_147)
        rows_rep35_u147 = res_rep35_u147.get(401, [])
        print(f"\nTotal rows in Entry 401 WITH user_147 for Report 35: {len(rows_rep35_u147)}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User, CustomReport, KPIField
from app.reports.custom_service import generate_custom_report_data
import app.reports.service as service_mod

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)

        orig_func = service_mod._load_multi_line_items_rows_batch
        async def patched_func(db, **kwargs):
            res = await orig_func(db, **{k: v for k, v in kwargs.items() if k != 'current_user'})
            for eid in res:
                res[eid] = [r for r in res[eid] if r.get('department') == 'Computer Science']
            print(f"DEBUG: patched_func returning {len(res.get(401, []))} rows")
            return res

        service_mod._load_multi_line_items_rows_batch = patched_func
        import app.reports.custom_service as cs_mod
        cs_mod._load_multi_line_items_rows_batch = patched_func

        cr34 = await db.get(CustomReport, 34)
        data = await generate_custom_report_data(
            db, 34, cr34.organization_id, year="2026", by_default=True, current_user=user_147
        )
        sec = data["sections"][0]
        for f in sec["fields"]:
            if f["field_type"] == "multi_line_items":
                print("Final MLI rows count:", len(f["value_items"]))
                # Print rows returned vs the 49
                returned_fac = {r.get("faculty_name") for r in f["value_items"]}
                
                # Check original 49
                raw_res = await orig_func(db, entry_ids=[401], field=await db.get(KPIField, 624))
                raw_cs = [r for r in raw_res.get(401, []) if r.get('department') == 'Computer Science']
                fall_49 = [r for r in raw_cs if float(r.get('total_survays_fall_2025') or 0) > 0]
                fall_49_fac = {r.get("faculty_name") for r in fall_49}
                diff = fall_49_fac - returned_fac
                print(f"Missing faculty in MLI ({len(diff)}):", diff)

if __name__ == "__main__":
    asyncio.run(main())

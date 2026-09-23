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

        # Monkey-patch _load_multi_line_items_rows_batch to test when rows are returned:
        orig_func = service_mod._load_multi_line_items_rows_batch
        async def patched_func(db, **kwargs):
            # If current_user is user_147 and field is 624:
            # Let's see what happens if we load rows without user and filter for 'Computer Science'
            res = await orig_func(db, **{k: v for k, v in kwargs.items() if k != 'current_user'})
            for eid in res:
                res[eid] = [r for r in res[eid] if r.get('department') == 'Computer Science']
            return res

        service_mod._load_multi_line_items_rows_batch = patched_func
        import app.reports.custom_service as cs_mod
        cs_mod._load_multi_line_items_rows_batch = patched_func

        for rid in [34, 35]:
            cr = await db.get(CustomReport, rid)
            print(f"\n=======================================================")
            print(f"REPORT {rid}: {cr.name} (WITH CS ROWS)")
            print(f"=======================================================")
            data = await generate_custom_report_data(
                db, rid, cr.organization_id, year="2026", by_default=True, current_user=user_147
            )
            sections = data.get("sections", [])
            for sec in sections:
                for field in sec.get("fields", []):
                    ft = field.get("field_type")
                    fn = field.get("field_name")
                    val = field.get("value")
                    items = field.get("value_items")
                    if ft == "formula":
                        print(f"  Formula Field '{fn}': value={val}")
                    elif ft == "multi_line_items":
                        print(f"  MLI Field '{fn}': rows count={len(items or [])}")

if __name__ == "__main__":
    asyncio.run(main())

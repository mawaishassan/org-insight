import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User, CustomReport
from app.reports.custom_service import generate_custom_report_data
import app.reports.service as service_mod

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)

        orig_func = service_mod._load_multi_line_items_rows_batch
        async def patched_func(db, **kwargs):
            f = kwargs.get('field')
            res = await orig_func(db, **kwargs)
            # Only filter field 624 (KPI 278)
            if f and f.id == 624:
                # Load without user, then filter for Computer Science
                raw_res = await orig_func(db, **{k: v for k, v in kwargs.items() if k != 'current_user'})
                for eid in raw_res:
                    raw_res[eid] = [r for r in raw_res[eid] if r.get('department') == 'Computer Science']
                return raw_res
            return res

        service_mod._load_multi_line_items_rows_batch = patched_func
        import app.reports.custom_service as cs_mod
        cs_mod._load_multi_line_items_rows_batch = patched_func

        for rid in [34, 35]:
            cr = await db.get(CustomReport, rid)
            print(f"\n=======================================================")
            print(f"REPORT {rid}: {cr.name}")
            print(f"=======================================================")
            data = await generate_custom_report_data(
                db, rid, cr.organization_id, year="2026", by_default=True, current_user=user_147
            )
            sec = data["sections"][0]
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

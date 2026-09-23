import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User, CustomReport

async def main():
    async with AsyncSessionLocal() as db:
        print("=== DEBUGGING REPORT 36 (Fall 2025) & REPORT 37 (Spring 2026) ===")
        
        # User 147 (Haseeb Shafique)
        user_147 = await db.get(User, 147)
        
        for r_id in [36, 37]:
            rep = await db.get(CustomReport, r_id)
            print(f"\n==================================================")
            print(f"REPORT {r_id}: Name='{rep.name}', OrgID={rep.organization_id}")

            # 1. Full Mode (by_default=True, user=None)
            print(f"\n--- [Report {r_id}] Full Mode (by_default=True, year=2026) ---")
            res_full = await generate_custom_report_data(db, r_id, 3, year=2026, by_default=True, current_user=None)
            if res_full:
                for sec in res_full.get("sections", []):
                    for f in sec.get("fields", []):
                        if f.get("field_type") == "multi_line_items":
                            vitems = f.get("value_items", [])
                            print(f"  Field '{f.get('field_name')}': Total MLI Rows = {len(vitems)}")
                            for idx, item in enumerate(vitems):
                                dname = str(item.get("department_name") or item.get("department") or "")
                                if "mechanical" in dname.lower():
                                    print(f"    FULL MODE Row {idx+1}: Dept='{dname}'")
                                    for k, v in item.items():
                                        if "taught" in k or "total" in k or "faculty" in k or "score" in k:
                                            print(f"      {k}: {v} (type: {type(v).__name__})")

            # 2. User Mode (Haseeb Shafique, by_default=False, current_user=user_147)
            print(f"\n--- [Report {r_id}] User Mode (Haseeb Shafique, by_default=False, year=2026) ---")
            res_user = await generate_custom_report_data(db, r_id, 3, year=2026, by_default=False, current_user=user_147)
            if res_user:
                for sec in res_user.get("sections", []):
                    for f in sec.get("fields", []):
                        if f.get("field_type") == "multi_line_items":
                            vitems = f.get("value_items", [])
                            print(f"  Field '{f.get('field_name')}': Total MLI Rows = {len(vitems)}")
                            for idx, item in enumerate(vitems):
                                dname = str(item.get("department_name") or item.get("department") or "")
                                if "mechanical" in dname.lower():
                                    print(f"    USER MODE Row {idx+1}: Dept='{dname}'")
                                    for k, v in item.items():
                                        if "taught" in k or "total" in k or "faculty" in k or "score" in k:
                                            print(f"      {k}: {v} (type: {type(v).__name__})")
                            print(f"  Evaluated Footers: {f.get('evaluated_footer_rows')}")

if __name__ == "__main__":
    asyncio.run(main())

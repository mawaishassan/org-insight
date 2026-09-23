import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User, CustomReport

async def main():
    async with AsyncSessionLocal() as db:
        print("=== GENERATING CUSTOM REPORTS 36 & 37 (ORG_ID=3) ===")
        
        # User 147 (Haseeb Shafique)
        user_147 = await db.get(User, 147)
        print(f"User 147: Email='{user_147.email}', FullName='{user_147.full_name}', Key='{user_147.unique_user_key}'")

        # Admin user (User ID 3 or User ID 7)
        admin_user = await db.get(User, 3)

        for r_id in [36, 37]:
            rep = await db.get(CustomReport, r_id)
            print(f"\n==================================================")
            print(f"REPORT {r_id}: Name='{rep.name}', OrgID={rep.organization_id}, fetch_data_with_date={getattr(rep, 'fetch_data_with_date', None)}")

            for yr in ["2026", "2025"]:
                print(f"\n--- [Report {r_id}] Year = {yr} ---")
                
                # 1. Full / Admin Mode (by_default=True)
                print(f"  > Mode: FULL / ADMIN MODE (by_default=True, current_user=None)")
                res_admin = await generate_custom_report_data(db, r_id, 3, year=yr, by_default=True, current_user=None)
                if res_admin:
                    sections = res_admin.get("sections", [])
                    for sec in sections:
                        print(f"    Section: '{sec.get('title')}'")
                        rows = sec.get("rows", [])
                        print(f"    Total Rows in Section: {len(rows)}")
                        for r in rows:
                            row_str = str(r)
                            if "mechanical" in row_str.lower():
                                print(f"      MECH ROW (FULL MODE): {r}")
                        footers = sec.get("footer_rows", [])
                        if footers:
                            print(f"      FOOTERS (FULL MODE): {footers}")
                else:
                    print("    Result is None!")

                # 2. User Mode (Haseeb Shafique, by_default=False, current_user=user_147)
                print(f"  > Mode: USER MODE (Haseeb Shafique, by_default=False, current_user=User 147)")
                res_user = await generate_custom_report_data(db, r_id, 3, year=yr, by_default=False, current_user=user_147)
                if res_user:
                    sections = res_user.get("sections", [])
                    for sec in sections:
                        print(f"    Section: '{sec.get('title')}'")
                        rows = sec.get("rows", [])
                        print(f"    Total Rows in Section: {len(rows)}")
                        for r in rows:
                            row_str = str(r)
                            if "mechanical" in row_str.lower():
                                print(f"      MECH ROW (USER MODE): {r}")
                        footers = sec.get("footer_rows", [])
                        if footers:
                            print(f"      FOOTERS (USER MODE): {footers}")
                else:
                    print("    Result is None!")

if __name__ == "__main__":
    from sqlalchemy import select
    asyncio.run(main())

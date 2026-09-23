import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User, CustomReport, ReportUserFilterConfiguration

async def main():
    async with AsyncSessionLocal() as db:
        print("=== CHECKING REPORT 36 & 37 WITH VARIOUS USERS AND YEARS ===")
        
        # Check ReportUserFilterConfiguration for reports 36 and 37
        filters = (await db.execute(select(ReportUserFilterConfiguration).where(ReportUserFilterConfiguration.report_id.in_([36, 37])))).scalars().all()
        print(f"ReportUserFilterConfigurations count: {len(filters)}")
        for f in filters:
            print(f"  Filter ID {f.id}: report_id={f.report_id}, kpi_id={f.kpi_id}, config={getattr(f, 'config', None) or getattr(f, 'filter_config', None)}")

        for r_id in [36, 37]:
            rep = await db.get(CustomReport, r_id)
            print(f"\n==================================================")
            print(f"REPORT {r_id}: Name='{rep.name}', OrgID={rep.organization_id}")
            
            for u_id in [3, 6, 147, 159]:
                user = await db.get(User, u_id)
                u_name = user.full_name if user else "Unknown"
                u_key = user.unique_user_key if user else None
                u_role = user.role if user else None
                print(f"\n--- User {u_id} ({u_name}, Role={u_role}, Key='{u_key}') ---")
                
                try:
                    res = await generate_custom_report_data(db, r_id, u_id, year="2026", by_default=False)
                    sections = res.get("sections", [])
                    print(f"  Sections count: {len(sections)}")
                    for sec in sections:
                        print(f"  Section: '{sec.get('title')}'")
                        rows = sec.get("rows", [])
                        print(f"  Rows count: {len(rows)}")
                        for r in rows:
                            dname = r.get("department_name") or r.get("department") or r.get("col_0") or str(r)
                            if "mechanical" in str(r).lower():
                                print(f"    MECH ROW IN REPORT: {r}")
                except Exception as ex:
                    print(f"  ERROR generating report: {ex}")
                    import traceback
                    traceback.print_exc()

if __name__ == "__main__":
    from sqlalchemy import select
    asyncio.run(main())

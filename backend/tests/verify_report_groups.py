import sys
import asyncio
sys.path.insert(0, "./backend")

from app.core.database import AsyncSessionLocal
from app.core.models import (
    Organization,
    CustomReport,
    CustomReportGroup
)
from app.reports.custom_report_groups.schemas import CustomReportGroupCreate, CustomReportGroupUpdate
from app.reports.custom_report_groups.service import (
    create_custom_report_group,
    list_custom_report_groups,
    update_custom_report_group,
    delete_custom_report_group,
    get_custom_report_group
)
from app.reports.custom_service import (
    create_custom_report,
    update_custom_report,
    get_custom_report
)
from app.reports.custom_schemas import CustomReportCreate, CustomReportUpdate
from sqlalchemy import select

async def run_verification():
    print("Starting Custom Report Groups Verification...")
    async with AsyncSessionLocal() as db:
        try:
            # 1. Fetch or create organization
            org_res = await db.execute(select(Organization).limit(1))
            org = org_res.scalar_one_or_none()
            if not org:
                org = Organization(name="Test Grouping Org")
                db.add(org)
                await db.flush()
            print(f"Using Organization: {org.name} (ID: {org.id})")

            # 2. Create custom report groups (sections)
            g1_data = CustomReportGroupCreate(name="Finance Reports", sort_order=1)
            g2_data = CustomReportGroupCreate(name="Academic Reports", sort_order=2)
            
            g1 = await create_custom_report_group(db, org.id, g1_data)
            g2 = await create_custom_report_group(db, org.id, g2_data)
            
            print(f"Created sections: '{g1.name}' (ID: {g1.id}) and '{g2.name}' (ID: {g2.id})")
            
            # Assert list sections returns them
            all_groups = await list_custom_report_groups(db, org.id)
            assert len(all_groups) >= 2
            assert any(g.name == "Finance Reports" for g in all_groups)
            assert any(g.name == "Academic Reports" for g in all_groups)
            print("Verified section listing [OK]")

            # 3. Create a custom report assigned to "Finance Reports" group
            rep_data = CustomReportCreate(
                name="Q4 Financial Health",
                description="Custom finance report template",
                group_id=g1.id
            )
            report = await create_custom_report(db, org.id, rep_data)
            print(f"Created custom report '{report.name}' associated with section ID: {report.group_id}")
            
            # Assert association is correct
            assert report.group_id == g1.id
            
            # 4. Update custom report to move to "Academic Reports" group
            rep_update = CustomReportUpdate(
                name="Q4 Academic Performance",
                description="Custom academic report template",
                group_id=g2.id
            )
            updated_report = await update_custom_report(db, report.id, org.id, rep_update)
            print(f"Updated custom report name to '{updated_report.name}' and section ID to: {updated_report.group_id}")
            
            assert updated_report.group_id == g2.id
            print("Verified report section re-assignment [OK]")

            # 5. Rename section
            g1_update = CustomReportGroupUpdate(name="Treasury & Finance Reports")
            updated_g1 = await update_custom_report_group(db, g1.id, org.id, g1_update)
            print(f"Renamed section '{g1.name}' to '{updated_g1.name}'")
            assert updated_g1.name == "Treasury & Finance Reports"
            print("Verified section rename [OK]")

            # 6. Delete section & verify cascading behavior (should NULL group_id in custom_reports)
            deleted = await delete_custom_report_group(db, g2.id, org.id)
            assert deleted is True
            print(f"Deleted section '{g2.name}'")
            
            # Refresh report and check its group_id
            await db.refresh(updated_report)
            print(f"After section deletion, report section ID is: {updated_report.group_id}")
            assert updated_report.group_id is None
            print("Verified cascade nullify on section delete [OK]")

            print("\nALL CUSTOM REPORT GROUPS DB TESTS PASSED [SUCCESS]")
        except Exception as e:
            print(f"\nVerification FAILED: {e}")
            raise
        finally:
            await db.rollback()
            print("Database transaction rolled back.")

if __name__ == "__main__":
    asyncio.run(run_verification())

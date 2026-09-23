import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import (
    User, CustomReport, CustomReportSection, CustomReportField,
    KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField, KPI
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        # Check Report 36 & 37 definitions
        for r_id in [36, 37]:
            rep = await db.get(CustomReport, r_id)
            if not rep:
                print(f"Report {r_id} not found!")
                continue
            print(f"\n==================================================")
            print(f"REPORT {r_id}: Name='{rep.name}', OrgID={rep.organization_id}")
            
            # Fetch report structure / sections / fields
            sections = (await db.execute(
                select(CustomReportSection).where(CustomReportSection.custom_report_id == r_id)
            )).scalars().all()
            for sec in sections:
                print(f"  Section ID: {sec.id}, Header: '{sec.custom_header}', KPI_ID: {sec.kpi_id}")
                fields = (await db.execute(
                    select(CustomReportField).where(CustomReportField.custom_report_section_id == sec.id)
                )).scalars().all()
                for f in fields:
                    print(f"    Field ID: {f.id}, KPIFieldID: {f.kpi_field_id}, Config: {f.config}")

            # Generate report data for Admin (user_id 3)
            print(f"\n  --- Generating Report Data for Admin (user_id=3) ---")
            data_full = await generate_custom_report_data(db, r_id, 3, year="2026", by_default=True)
            for sec_data in data_full.get("sections", []):
                print(f"  SecTitle: {sec_data.get('title')}")
                rows = sec_data.get("rows", [])
                print(f"  Total Rows: {len(rows)}")
                for row in rows:
                    row_dict = dict(row) if hasattr(row, 'items') else row
                    row_str = str(row_dict)
                    if "Mechanical" in row_str or "mechanical" in row_str.lower():
                        print(f"    ADMIN MECH ROW: {row_dict}")

            # Generate report data for User 147 (Haseeb Shafique, UniqueKey='Mechanical Engineering')
            print(f"\n  --- Generating Report Data for User 147 (Haseeb Shafique) ---")
            data_user = await generate_custom_report_data(db, r_id, 147, year="2026", by_default=False)
            for sec_data in data_user.get("sections", []):
                print(f"  SecTitle: {sec_data.get('title')}")
                rows = sec_data.get("rows", [])
                print(f"  Total Rows: {len(rows)}")
                for row in rows:
                    row_dict = dict(row) if hasattr(row, 'items') else row
                    row_str = str(row_dict)
                    if "Mechanical" in row_str or "mechanical" in row_str.lower():
                        print(f"    USER 147 MECH ROW: {row_dict}")
                footers = sec_data.get("footer_rows", [])
                print(f"    FOOTERS: {footers}")

if __name__ == "__main__":
    asyncio.run(main())

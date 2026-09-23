import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User, CustomReport, CustomReportSection, CustomReportField,
    KPI, KPIField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField
)
from sqlalchemy import select, and_, or_, func

async def main():
    async with AsyncSessionLocal() as db:
        r_id = 36
        org_id = 3
        user_147 = await db.get(User, 147)
        u_key = user_147.unique_user_key # 'Mechanical Engineering'
        print(f"User 147 unique_user_key: '{u_key}'")

        # Let's inspect KPI 277 (QEC Faculty Performance Dept Wise) and KPI 290 (Faculty Performance individual rows if any)
        # Wait! Is KPI 277 calculated from another KPI or is KPI 277 a multi line item KPI?
        # Let's check how KPI 277 entry rows are loaded or modified during generate_custom_report_data!

        # Let's check if there are multiple entries for KPI 277 in the DB or if KPI 277 is referenced by formula/aggregation!
        sec_325 = await db.get(CustomReportSection, 325)
        print(f"Section 325 KPI_ID: {sec_325.kpi_id}")
        
        # Check all KPIFields in Section 325
        fields = (await db.execute(select(CustomReportField).where(CustomReportField.custom_report_section_id == 325))).scalars().all()
        for f in fields:
            kf = await db.get(KPIField, f.kpi_field_id)
            print(f"Field ID {f.id}: KPI {kf.kpi_id}, Key='{kf.key}', Type='{kf.field_type}'")

if __name__ == "__main__":
    asyncio.run(main())

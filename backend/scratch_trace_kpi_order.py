import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import CustomReport, KPI
from app.reports.custom_service import get_custom_report, _sort_kpis_topologically

async def main():
    async with AsyncSessionLocal() as db:
        rep = await get_custom_report(db, 36, 3)
        
        # Get referenced KPIs for Report 36
        kpis_in_report = set()
        for sec in rep.sections:
            if sec.kpi_id:
                kpis_in_report.add(sec.kpi_id)
        print(f"KPIs directly in Report 36 sections: {kpis_in_report}")
        
        # Let's check how _sort_kpis_topologically sorts KPIs for Report 36
        kpi_objs = (await db.execute(select(KPI).where(KPI.id.in_([277, 278]))))\
.scalars().all()
        sorted_kpis = await _sort_kpis_topologically(db, kpi_objs)
        print("Sorted KPIs topological order:")
        for k in sorted_kpis:
            print(f"  KPI ID {k.id}: Name='{k.name}'")

if __name__ == "__main__":
    from sqlalchemy import select
    asyncio.run(main())

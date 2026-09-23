import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import CustomReport, ReportTemplate, Dashboard

async def main():
    async with AsyncSessionLocal() as db:
        crs = (await db.execute(select(CustomReport))).scalars().all()
        print("=== ALL CUSTOM REPORTS ===")
        for cr in crs:
            print(f"ID: {cr.id}, Name: '{cr.name}', Org: {cr.organization_id}")

        rts = (await db.execute(select(ReportTemplate))).scalars().all()
        print("\n=== ALL REPORT TEMPLATES ===")
        for rt in rts:
            print(f"ID: {rt.id}, Name: '{rt.name}', Org: {rt.organization_id}")

        ds = (await db.execute(select(Dashboard))).scalars().all()
        print("\n=== ALL DASHBOARDS ===")
        for d in ds:
            print(f"ID: {d.id}, Name: '{d.name}', Org: {d.organization_id}")

if __name__ == '__main__':
    asyncio.run(main())

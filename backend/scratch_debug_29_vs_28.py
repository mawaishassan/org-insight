import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User, CustomReport, CustomReportSection, CustomReportField,
    KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField, KPI
)
from sqlalchemy import select, func, or_

async def main():
    async with AsyncSessionLocal() as db:
        print("=== USER COLUMNS ===")
        print(User.__table__.columns.keys())

        users = (await db.execute(select(User).where(
            or_(
                User.email.ilike("%haseeb%"),
                User.name.ilike("%haseeb%") if hasattr(User, 'name') else User.email.ilike("%haseeb%")
            )
        ))).scalars().all()
        
        for u in users:
            print(f"User ID: {u.id}, Email: {u.email}, Role: {u.role}, UniqueKey: {getattr(u, 'unique_user_key', None)}")

        print("\n=== ALL CUSTOM REPORTS ===")
        reports = (await db.execute(select(CustomReport))).scalars().all()
        for r in reports:
            print(f"Report ID: {r.id}, Name: '{r.name}', OrgID: {r.organization_id}")

if __name__ == "__main__":
    asyncio.run(main())

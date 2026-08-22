import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import Organization

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Organization).where(Organization.id == 3))
        org = res.scalar_one()
        print(f"Org ID: {org.id}")
        print(f"custom_period_start_month: {getattr(org, 'custom_period_start_month', None)}")
        print(f"custom_period_start_day: {getattr(org, 'custom_period_start_day', None)}")
        print(f"custom_periods: {getattr(org, 'custom_periods', None)}")

if __name__ == "__main__":
    asyncio.run(main())

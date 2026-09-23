import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import ReportUserFilterConfiguration
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        filters = (await db.execute(
            select(ReportUserFilterConfiguration).where(ReportUserFilterConfiguration.report_id.in_([36, 37]))
        )).scalars().all()
        for f in filters:
            print(f"Filter {f.id}: report_id={f.report_id}")
            for col in f.__table__.columns.keys():
                print(f"  {col}: {getattr(f, col)}")

if __name__ == "__main__":
    asyncio.run(main())

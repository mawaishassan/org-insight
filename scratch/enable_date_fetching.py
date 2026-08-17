import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import ReportTemplate, CustomReport

async def main():
    async with AsyncSessionLocal() as db:
        # Enable on standard report template ID 5
        res = await db.execute(select(ReportTemplate).where(ReportTemplate.id == 5))
        rt = res.scalar_one_or_none()
        if rt:
            rt.fetch_data_with_date = True
            print("Enabled fetch_data_with_date on ReportTemplate ID 5")
            
        # Enable on custom report ID 1
        res2 = await db.execute(select(CustomReport).where(CustomReport.id == 1))
        cr = res2.scalar_one_or_none()
        if cr:
            cr.fetch_data_with_date = True
            print("Enabled fetch_data_with_date on CustomReport ID 1")
            
        await db.commit()

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from app.core.models import CustomReportHeader

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(CustomReportHeader))
        headers = res.scalars().all()
        print(f"Total headers found: {len(headers)}")
        for h in headers:
            print(f"Header ID: {h.id}")
            print(f"  Name: {h.name}")
            print(f"  Main Heading: {h.main_heading}")
            print(f"  Font Family: {repr(h.font_family)}")
            print(f"  Font Size: {repr(h.font_size)}")
            print(f"  Text Color: {repr(h.text_color)}")
            print("-" * 30)

if __name__ == "__main__":
    asyncio.run(main())

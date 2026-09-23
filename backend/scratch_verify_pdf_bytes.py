import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import export_custom_report_file, CUSTOM_REPORT_CACHE
from app.core.models import User
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        CUSTOM_REPORT_CACHE.invalidate_report(36)
        CUSTOM_REPORT_CACHE.invalidate_report(37)
        admin = (await db.execute(select(User).where(User.role == "SUPER_ADMIN"))).scalars().first()

        for r_id in [36, 37]:
            file_bytes, filename, content_type = await export_custom_report_file(
                db, r_id, 3, year="2026", format="pdf", by_default=True, current_user=admin
            )
            print(f"Report {r_id} exported PDF: filename='{filename}', bytes={len(file_bytes)}")
            
            # Check raw bytes for text or numbers
            has_29 = b"29" in file_bytes
            has_27 = b"27" in file_bytes
            has_28 = b"28" in file_bytes
            has_25 = b"25" in file_bytes
            print(f"  PDF byte search: contains '29': {has_29}, contains '27': {has_27}, contains '28': {has_28}, contains '25': {has_25}")

if __name__ == "__main__":
    asyncio.run(main())

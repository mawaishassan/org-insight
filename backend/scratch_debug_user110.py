import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User, CustomReport, ReportUserFilterConfiguration
from app.reports.custom_service import generate_custom_report_data
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        u110 = (await db.execute(select(User).where(User.id == 110))).scalar_one_or_none()
        print(f"User 110: email='{u110.email}', role='{u110.role}', key='{u110.unique_user_key}'")

        data36 = await generate_custom_report_data(db, 36, 3, year="2026", by_default=True, current_user=u110)
        print("\nData 36 returned sections:")
        for sec in data36.get("sections", []):
            print(f" Section {sec.get('section_id')}: title='{sec.get('title')}'")
            for f in sec.get("fields", []):
                print(f"  Field '{f.get('field_name')}': type={f.get('field_type')}, value={f.get('value')}")
                if f.get("field_type") == "multi_line_items":
                    val_items = f.get("value_items") or []
                    print(f"   Value items count: {len(val_items)}")
                    for r in val_items:
                        print(f"     Row: {r}")

if __name__ == "__main__":
    asyncio.run(main())

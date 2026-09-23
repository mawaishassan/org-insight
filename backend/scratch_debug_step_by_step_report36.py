import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)
        print(f"User 147: Email='{user_147.email}', FullName='{user_147.full_name}', Key='{user_147.unique_user_key}'")

        # Let's inspect generate_custom_report_data results for Report 36 with current_user=user_147
        data = await generate_custom_report_data(db, 36, 3, year=2026, by_default=False, current_user=user_147)
        
        # Print all fields in all sections of data
        for sec in data.get("sections", []):
            print(f"\nSection '{sec.get('custom_header')}' (KPI {sec.get('kpi_id')}):")
            for f in sec.get("fields", []):
                print(f"  Field '{f.get('field_name')}' ({f.get('field_key')}, Type={f.get('field_type')}):")
                if f.get("field_type") == "multi_line_items":
                    vitems = f.get("value_items", [])
                    print(f"    Value Items Count = {len(vitems)}")
                    for item in vitems:
                        print(f"    Item: {item}")
                else:
                    print(f"    Value = {f.get('value')}")

if __name__ == "__main__":
    asyncio.run(main())

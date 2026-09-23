import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User, CustomReport

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)
        print(f"User 147: Email='{user_147.email}', FullName='{user_147.full_name}', Key='{user_147.unique_user_key}'")

        # Run Report 36 (Fall 2025) with year=2026, by_default=False, current_user=user_147
        print("\n--- REPORT 36 (Fall 2025) FOR HASEEB SHAFIQUE ---")
        data_36 = await generate_custom_report_data(db, 36, 3, year=2026, by_default=False, current_user=user_147)
        for sec in data_36.get("sections", []):
            for f in sec.get("fields", []):
                if f.get("field_type") == "multi_line_items":
                    for item in f.get("value_items", []):
                        if "mechanical" in str(item).lower():
                            print("MECH ITEM IN REPORT 36:")
                            for k, v in item.items():
                                print(f"  {k}: {v}")

        # Run Report 37 (Spring 2026) with year=2026, by_default=False, current_user=user_147
        print("\n--- REPORT 37 (Spring 2026) FOR HASEEB SHAFIQUE ---")
        data_37 = await generate_custom_report_data(db, 37, 3, year=2026, by_default=False, current_user=user_147)
        for sec in data_37.get("sections", []):
            for f in sec.get("fields", []):
                if f.get("field_type") == "multi_line_items":
                    for item in f.get("value_items", []):
                        if "mechanical" in str(item).lower():
                            print("MECH ITEM IN REPORT 37:")
                            for k, v in item.items():
                                print(f"  {k}: {v}")

if __name__ == "__main__":
    asyncio.run(main())

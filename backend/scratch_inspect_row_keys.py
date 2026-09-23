import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        admin = (await db.execute(select(User).where(User.role == "SUPER_ADMIN"))).scalars().first()
        data = await generate_custom_report_data(db, 36, 3, year="2026", by_default=True, current_user=admin)
        for sec in data.get("sections", []):
            for f in sec.get("fields", []):
                if f.get("field_type") == "multi_line_items":
                    rows = f.get("value_items") or []
                    print(f"Total rows in Report 36: {len(rows)}")
                    if rows:
                        print("Sample Row keys:", list(rows[0].keys()))
                        print("Sample Row 0:", rows[0])
                        for r in rows:
                            # Print any row that has mechanical in values
                            vals_str = " ".join(str(v) for v in r.values()).lower()
                            if "mechanical" in vals_str:
                                print("\nMechanical row found:")
                                for k, v in r.items():
                                    print(f"   '{k}': {v}")

if __name__ == "__main__":
    asyncio.run(main())

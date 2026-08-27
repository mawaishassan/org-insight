import asyncio
import traceback
from app.core.database import AsyncSessionLocal
from app.core.models import Organization
from app.widget_data.service import resolve_date_range_for_period

async def main():
    async with AsyncSessionLocal() as db:
        org = await db.get(Organization, 3)
        print("Organization Time Dimension:", org.time_dimension)
        
        # Test exact inputs from export
        try:
            start_date, end_date, entry_year = resolve_date_range_for_period(org, "2026/27", "Fiscal Year")
            print(f"Resolution for '2026/27', 'Fiscal Year':")
            print(f"  Start Date: {start_date}")
            print(f"  End Date: {end_date}")
            print(f"  Entry Year: {entry_year}")
        except Exception as e:
            print("Error resolving:")
            traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(main())

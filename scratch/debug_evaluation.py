import asyncio
import sys
from pathlib import Path
import datetime

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import Dashboard, KPI, KPIEntry, KpiMultiLineRow, KPIField
from app.widget_data.service import _dashboard_card_payload

async def main():
    async with AsyncSessionLocal() as db:
        # Load Dashboard 12
        res = await db.execute(select(Dashboard).where(Dashboard.id == 12))
        d = res.scalar_one()
        
        # Get "Total Patents" widget from layout
        w = next(widget for widget in d.layout["widgets"] if widget["id"] == "w_jbhnc62x_ms30cmaa")
        
        # In actual run, merged widget gets date_fetching_config
        w["date_fetching_config"] = d.date_fetching_config
        
        # Simulating fiscal year 2025/26 (July 1, 2025 to June 30, 2026)
        start_date = datetime.date(2025, 7, 1)
        end_date = datetime.date(2026, 6, 30)
        date_range = (start_date, end_date, "date_of_filing")
        
        # Let's run _dashboard_card_payload
        meta, data, e_rev = await _dashboard_card_payload(
            db,
            org_id=d.organization_id,
            merged=w,
            user=None,
            date_range=date_range
        )
        print("Meta:", meta)
        print("Data:", data)
        print("Revision:", e_rev)

if __name__ == "__main__":
    asyncio.run(main())

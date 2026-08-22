import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import User, Dashboard
from app.widget_data.service import (
    resolve_dashboard_universal_batch,
    resolve_dashboard_card_widget_data_batch
)

async def main():
    async with AsyncSessionLocal() as db:
        user_res = await db.execute(select(User).where(User.id == 7))
        user = user_res.scalar_one()
        
        dash_res = await db.execute(select(Dashboard).where(Dashboard.id == 12))
        dashboard = dash_res.scalar_one()
        
        # Let's pick the first card widget
        card_widget = None
        for w in dashboard.layout["widgets"]:
            if w.get("type") == "kpi_card_single_value":
                card_widget = w
                break
                
        print("Card widget in layout:")
        print(card_widget)
        
        items = [{"widget": card_widget, "overrides": {}}]
        
        print("\nCalling resolve_dashboard_card_widget_data_batch directly...")
        res = await resolve_dashboard_card_widget_data_batch(
            db, user, user.organization_id, dashboard.id, items
        )
        print("Direct resolver results:")
        print(res)

if __name__ == "__main__":
    asyncio.run(main())

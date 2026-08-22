import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import User, Dashboard
from app.widget_data.service import resolve_dashboard_universal_batch

async def main():
    async with AsyncSessionLocal() as db:
        # Load user ID 7 (associated with organization_id 3 as per the token in log)
        user_res = await db.execute(select(User).where(User.id == 7))
        user = user_res.scalar_one()
        
        # Load Dashboard 12
        dash_res = await db.execute(select(Dashboard).where(Dashboard.id == 12))
        dashboard = dash_res.scalar_one()
        
        # Construct the payload items list
        items = []
        for widget in dashboard.layout["widgets"]:
            items.append({
                "widget": widget,
                "overrides": {}
            })
            
        print("Starting resolve_dashboard_universal_batch...")
        results = await resolve_dashboard_universal_batch(
            db,
            user=user,
            org_id=user.organization_id,
            dashboard_id=dashboard.id,
            items=items
        )
        print("Completed resolve_dashboard_universal_batch!")
        print("Results keys:", list(results.keys()))

if __name__ == "__main__":
    asyncio.run(main())

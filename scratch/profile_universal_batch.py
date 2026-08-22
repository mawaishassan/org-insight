import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import User, Dashboard
from app.widget_data.service import (
    resolve_dashboard_universal_batch,
    resolve_dashboard_chart_widget_data_batch,
    resolve_dashboard_card_widget_data_batch,
    resolve_dashboard_table_widget_data,
    resolve_dashboard_line_widget_data,
    resolve_dashboard_trend_widget_data,
    resolve_dashboard_single_value_widget_data,
    resolve_dashboard_kpi_table_widget_data
)

async def main():
    async with AsyncSessionLocal() as db:
        user_res = await db.execute(select(User).where(User.id == 7))
        user = user_res.scalar_one()
        
        dash_res = await db.execute(select(Dashboard).where(Dashboard.id == 12))
        dashboard = dash_res.scalar_one()
        
        print("Parsing widgets...")
        # Let's profile them one by one to see who is slow!
        for widget in dashboard.layout["widgets"]:
            wid = widget.get("id")
            wtype = widget.get("type")
            print(f"\nProfiling widget {wid} ({wtype})...")
            
            t0 = time.perf_counter()
            try:
                # We can call resolve_dashboard_universal_batch with just this ONE widget!
                res = await resolve_dashboard_universal_batch(
                    db,
                    user=user,
                    org_id=user.organization_id,
                    dashboard_id=dashboard.id,
                    items=[{"widget": widget, "overrides": {}}]
                )
                dt = (time.perf_counter() - t0) * 1000.0
                print(f"  Completed in {dt:.1f}ms")
                print(f"  Result: {res.get(wid)}")
            except Exception as e:
                print(f"  Failed in {(time.perf_counter() - t0)*1000.0:.1f}ms with error: {e}")

if __name__ == "__main__":
    asyncio.run(main())

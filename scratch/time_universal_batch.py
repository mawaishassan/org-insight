import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import User, Dashboard
from app.widget_data.service import resolve_dashboard_universal_batch

async def main():
    async with AsyncSessionLocal() as db:
        user_res = await db.execute(select(User).where(User.id == 7))
        user = user_res.scalar_one()
        
        dash_res = await db.execute(select(Dashboard).where(Dashboard.id == 12))
        dashboard = dash_res.scalar_one()
        
        items = []
        for widget in dashboard.layout["widgets"]:
            items.append({
                "widget": widget,
                "overrides": {}
            })
            
        t0 = time.perf_counter()
        results = await resolve_dashboard_universal_batch(
            db,
            user=user,
            org_id=user.organization_id,
            dashboard_id=dashboard.id,
            items=items
        )
        t1 = time.perf_counter()
        
        print(f"resolve_dashboard_universal_batch completed in {(t1 - t0) * 1000.0:.1f}ms")
        for k, v in results.items():
            ok = v.get("ok")
            wtype = v.get("widget_type")
            err = v.get("error")
            print(f"  Widget {k} ({wtype}): ok={ok}, err={err}")

if __name__ == "__main__":
    asyncio.run(main())

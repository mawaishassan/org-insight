import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.entries.load_joined import load_joined_multi_line_rows
from app.core.models import KPI, KPIField

async def main():
    async with AsyncSessionLocal() as db:
        print("=== TESTING load_joined_multi_line_rows FOR KPI 277 ===")
        # Get KPI 277 field 623
        from sqlalchemy.orm import selectinload
        kfield_res = await db.execute(select(KPIField).where(KPIField.id == 623).options(selectinload(KPIField.kpi)))
        kfield = kfield_res.scalar_one()
        print(f"Joined Field: ID={kfield.id}, Key='{kfield.key}', KPI_ID={kfield.kpi_id}")
        
        # 1. Without current_user_id (Admin / Unrestricted)
        rows_no_user = await load_joined_multi_line_rows(
            db, joined_field=kfield, organization_id=3, year=2026, period_key="", current_user_id=None
        )
        print(f"\nRows without current_user_id ({len(rows_no_user)} rows):")
        for r in rows_no_user:
            dname = str(r.get("department_name") or r.get("department") or "")
            if "mechanical" in dname.lower():
                print(f"  ADMIN MECH ROW: {r}")

        # 2. With current_user_id = 147 (Haseeb Shafique)
        rows_user_147 = await load_joined_multi_line_rows(
            db, joined_field=kfield, organization_id=3, year=2026, period_key="", current_user_id=147
        )
        print(f"\nRows with current_user_id = 147 ({len(rows_user_147)} rows):")
        for r in rows_user_147:
            dname = str(r.get("department_name") or r.get("department") or "")
            if "mechanical" in dname.lower():
                print(f"  USER 147 MECH ROW: {r}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User, KPIField, KPIFieldSubField
from app.reports.custom_service import get_custom_report, bulk_load_org_kpi_values, _load_multi_line_items_rows_batch
from app.formula_engine.evaluator import evaluate_formula

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)
        u_key = user_147.unique_user_key # 'Mechanical Engineering'
        print(f"User 147 unique_user_key: '{u_key}'")

        # Let's inspect what happens in custom_service.py around lines 950-1200:
        # 1. base_other_kpi_values:
        base_other_kpi_values = await bulk_load_org_kpi_values(db, 2026, 3)
        print(f"\n1. base_other_kpi_values keys count: {len(base_other_kpi_values)}")

        # Check what base_other_kpi_values contains for KPI 278 (Faculty Wise)
        # KPI 278 fields:
        fields_278 = (await db.execute(select(KPIField).where(KPIField.kpi_id == 278))).scalars().all()
        for f in fields_278:
            val = base_other_kpi_values.get((278, f.key))
            print(f"   Base KPI 278 field '{f.key}' ({f.name}): {val}")

        # KPI 277 fields:
        fields_277 = (await db.execute(select(KPIField).where(KPIField.kpi_id == 277))).scalars().all()
        for f in fields_277:
            val = base_other_kpi_values.get((277, f.key))
            print(f"   Base KPI 277 field '{f.key}' ({f.name}): {val}")

if __name__ == "__main__":
    from sqlalchemy import select
    asyncio.run(main())

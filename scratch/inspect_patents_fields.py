import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIField, KPIFieldSubField, KPIFieldValue

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(KPIField).where(KPIField.kpi_id == 212))
        fields = res.scalars().all()
        for f in fields:
            print(f"Field: {f.name} (Key: {f.key}, Type: {f.field_type}, formula_expression: {f.formula_expression})")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIField, KPIFieldSubField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        kpi = (await db.execute(select(KPI).where(KPI.id == 277))).scalar_one_or_none()
        print(f"KPI 277: name='{kpi.name}'")
        fields = (await db.execute(select(KPIField).where(KPIField.kpi_id == 277))).scalars().all()
        print("Fields:")
        for f in fields:
            print(f"  Field ID {f.id}: name='{f.name}', key='{f.key}', type='{f.field_type}', formula='{f.formula_expression}'")
            sfs = (await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == f.id))).scalars().all()
            for sf in sfs:
                print(f"     SubField ID {sf.id}: name='{sf.name}', key='{sf.key}', type='{sf.field_type}', formula='{getattr(sf, 'formula_expression', None)}'")

if __name__ == "__main__":
    asyncio.run(main())

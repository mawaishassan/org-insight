import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIEntry, KPIFieldValue, KpiMultiLineRow
from app.entries.load_joined import load_joined_scalar_values
from app.widget_data.service import evaluate_kpi_scalar_formula_field

async def main():
    async with AsyncSessionLocal() as db:
        kpi = await db.get(KPI, 317)
        print(f"KPI 317: {kpi.name}")
        
        ent_res = await db.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == 317)
        )
        entries = ent_res.scalars().all()
        print(f"Found {len(entries)} entries for KPI 317:")
        for e in entries:
            print(f"\nEntry ID: {e.id}, Year: {e.year}, Period: '{e.period_key}', Draft: {e.is_draft}")
            
            # Check physical rows in KpiMultiLineRow
            rows_res = await db.execute(
                select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id)
            )
            rows = rows_res.scalars().all()
            print(f"  Physical MLI rows: {len(rows)}")
            
            # Check physical KPIFieldValue
            fvs_res = await db.execute(
                select(KPIFieldValue).where(KPIFieldValue.entry_id == e.id)
            )
            fvs = fvs_res.scalars().all()
            print(f"  Physical KPIFieldValue records: {len(fvs)}")
            for fv in fvs:
                print(f"    FV field_id={fv.field_id}: num={fv.value_number}, text={fv.value_text}")
                
            # Check load_joined_scalar_values
            virtual_fvs = await load_joined_scalar_values(db, joined_kpi=kpi, entry_id=e.id)
            print(f"  load_joined_scalar_values returned: {len(virtual_fvs)} items")
            for vf in virtual_fvs:
                print(f"    Virtual FV field_id={vf.field_id}: num={vf.value_number}, text={vf.value_text}")

            # Check evaluate_kpi_scalar_formula_field
            f_formula = next((f for f in kpi.fields if f.id == 744), None)
            val = await evaluate_kpi_scalar_formula_field(
                db, e.organization_id, kpi.id, e.year, e.period_key, f_formula, e.id
            )
            print(f"  evaluate_kpi_scalar_formula_field: {val}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPIField, KPIEntry, KPIFieldValue

async def main():
    async with AsyncSessionLocal() as db:
        # Load fields for KPI 177
        stmt_fields = select(KPIField).where(KPIField.kpi_id == 177)
        res_fields = await db.execute(stmt_fields)
        fields = res_fields.scalars().all()
        print("Fields for KPI 177:")
        for f in fields:
            print(f"  ID: {f.id}, Key: {f.key}, Name: {f.name}, Type: {f.field_type.value if hasattr(f.field_type, 'value') else f.field_type}, Formula: {f.formula_expression}")

        # Check entries for organization 3, year 2026
        stmt_entries = select(KPIEntry).where(KPIEntry.organization_id == 3, KPIEntry.year == 2026, KPIEntry.kpi_id == 177)
        res_entries = await db.execute(stmt_entries)
        entries = res_entries.scalars().all()
        print(f"\nEntries count: {len(entries)}")
        for e in entries:
            print(f"Entry ID: {e.id}, is_draft: {e.is_draft}, period_key: {repr(e.period_key)}")
            
            # Print field values
            stmt_fvs = select(KPIFieldValue).where(KPIFieldValue.entry_id == e.id)
            res_fvs = await db.execute(stmt_fvs)
            fvs = res_fvs.scalars().all()
            print("  Scalar values:")
            for fv in fvs:
                # Find matching field name
                f_name = next((f.name for f in fields if f.id == fv.field_id), "Unknown")
                print(f"    - Field ID {fv.field_id} ({f_name}): num={fv.value_number}, text={fv.value_text}")

if __name__ == "__main__":
    asyncio.run(main())

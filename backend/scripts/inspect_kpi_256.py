import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField

async def main():
    async with AsyncSessionLocal() as db:
        kpi = await db.get(KPI, 256)
        print(f"KPI 256 Name: {kpi.name}")
        for f in kpi.fields:
            print(f"  Field: id={f.id}, name='{f.name}', key='{f.key}', type={f.field_type}")
            if f.field_type.value == "formula":
                print(f"    Formula: {f.formula_expression}")

        ent_res = await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == 256, KPIEntry.organization_id == 3))
        entries = ent_res.scalars().all()
        print(f"\nEntries found: {len(entries)}")
        for e in entries:
            print(f"  Entry ID: {e.id}, Year: {e.year}, Period: '{e.period_key}', Draft: {e.is_draft}")
            # Let's count rows in 'department_wise_patents_submission_details' (field_id is 586)
            row_res = await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id, KpiMultiLineRow.field_id == 586))
            rows = row_res.scalars().all()
            print(f"    Field 586 Rows: {len(rows)}")
            # Let's print non-zero rows
            for row in rows:
                cell_res = await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == row.id))
                cells = cell_res.scalars().all()
                row_data = {}
                for c in cells:
                    sf = await db.get(KPIFieldSubField, c.sub_field_id)
                    if sf:
                        row_data[sf.key] = c.value_number if c.value_number is not None else (c.value_text or c.value_date)
                if row_data.get("total_submissions", 0) > 0:
                    print(f"      Row index {row.row_index}: {row_data}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
from sqlalchemy import select
from app.core.database import get_db
from app.core.models import KPI, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIField, KPIFieldSubField
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, selectinload
from app.core.config import get_settings

async def main():
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        # Fetch entries for KPI 243
        res = await db.execute(
            select(KPIEntry)
            .where(KPIEntry.kpi_id == 243)
            .options(selectinload(KPIEntry.field_values))
        )
        entries = res.scalars().all()
        for entry in entries:
            print(f"Entry ID: {entry.id}, Year: {entry.year}, is_draft: {entry.is_draft}")
            # Fetch fields
            fields_res = await db.execute(
                select(KPIField)
                .where(KPIField.kpi_id == 243)
                .options(selectinload(KPIField.sub_fields))
            )
            fields = fields_res.scalars().all()
            for f in fields:
                print(f"  Field: {f.name} (ID: {f.id})")
                rows_res = await db.execute(
                    select(KpiMultiLineRow)
                    .where(KpiMultiLineRow.entry_id == entry.id, KpiMultiLineRow.field_id == f.id)
                    .options(selectinload(KpiMultiLineRow.cells).selectinload(KpiMultiLineCell.sub_field))
                )
                rows = rows_res.scalars().all()
                for r in rows:
                    row_data = {}
                    for c in r.cells:
                        val = c.value_number if c.value_number is not None else c.value_text
                        row_data[c.sub_field.key] = val
                    print(f"    Row index {r.row_index}: {row_data}")

if __name__ == "__main__":
    asyncio.run(main())

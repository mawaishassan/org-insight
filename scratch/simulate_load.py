import asyncio
import os
import sys

# Add backend app to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, selectinload
from sqlalchemy import select

DATABASE_URL = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"

async def main():
    engine = create_async_engine(DATABASE_URL, echo=True)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        from app.core.models import KPIField, KPIEntry
        from app.entries.service import resolve_linked_columns_in_rows_batch
        
        # Load field 642
        field_res = await db.execute(
            select(KPIField)
            .where(KPIField.id == 642)
            .options(selectinload(KPIField.sub_fields))
        )
        field = field_res.scalar_one()
        
        print("\n--- TARGET FIELD CONFIG ---")
        print("config:", field.config)
        
        # Load empty current rows for entry 386
        entry_id = 386
        rows_by_entry_id = {entry_id: []}
        
        print("\n--- RUNNING resolve_linked_columns_in_rows_batch ---")
        res = await resolve_linked_columns_in_rows_batch(
            db,
            entry_ids=[entry_id],
            field=field,
            rows_by_entry_id=rows_by_entry_id
        )
        
        print("\n--- RESULT ---")
        print("Returned rows for entry 386:", len(res.get(entry_id, [])))
        if res.get(entry_id):
            print("First 3 rows:", res[entry_id][:3])

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())

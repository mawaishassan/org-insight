import asyncio
from sqlalchemy import select
from app.core.database import get_db
from app.core.models import KPIEntry
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings
from app.entries.service import propagate_formula_recalculations

async def main():
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        res = await db.execute(
            select(KPIEntry)
            .where(KPIEntry.kpi_id == 243)
        )
        entries = res.scalars().all()
        print(f"Found {len(entries)} entries for KPI 243 to recalculate...")
        
        for idx, entry in enumerate(entries):
            print(f"Recalculating entry {entry.id} (Year: {entry.year})...")
            try:
                await propagate_formula_recalculations(db, entry_id=entry.id, org_id=entry.organization_id)
            except Exception as e:
                print(f"  Error: {e}")
        
        await db.commit()
        print("Done!")

if __name__ == "__main__":
    asyncio.run(main())

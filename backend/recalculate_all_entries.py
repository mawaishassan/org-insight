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
        # Fetch all entries in the database
        res = await db.execute(select(KPIEntry))
        entries = res.scalars().all()
        print(f"Found {len(entries)} entries to recalculate...")
        
        for idx, entry in enumerate(entries):
            print(f"[{idx+1}/{len(entries)}] Recalculating entry {entry.id} (KPI: {entry.kpi_id}, Year: {entry.year}, Draft: {entry.is_draft})...")
            try:
                await propagate_formula_recalculations(db, entry_id=entry.id, org_id=entry.organization_id)
            except Exception as e:
                print(f"  Error on entry {entry.id}: {e}")
        
        await db.commit()
        print("All entries successfully recalculated and committed!")

if __name__ == "__main__":
    asyncio.run(main())

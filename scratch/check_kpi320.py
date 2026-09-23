import sys, asyncio
sys.path.insert(0, 'backend')

async def main():
    from app.core.database import AsyncSessionLocal
    from app.core.models import KPI
    from app.entries.joined_sync import sync_joined_kpi_physical_data
    from sqlalchemy import select, text
    
    print("Starting KPI 320 sync...", flush=True)
    
    async with AsyncSessionLocal() as db:
        kpi_res = await db.execute(select(KPI).where(KPI.id == 320))
        kpi = kpi_res.scalar_one_or_none()
        print(f"KPI found: {kpi.name if kpi else 'NOT FOUND'}", flush=True)
        
        # Before count
        before = (await db.execute(text("SELECT COUNT(*) FROM kpi_multi_line_rows WHERE entry_id=457"))).scalar()
        print(f"Before sync: {before} rows in entry 457", flush=True)
        
        total = await sync_joined_kpi_physical_data(db, kpi)
        print(f"Sync complete! Total rows: {total}", flush=True)
        
        await db.commit()
        
        # After count
        async with AsyncSessionLocal() as db2:
            after = (await db2.execute(text("SELECT COUNT(*) FROM kpi_multi_line_rows WHERE entry_id=457"))).scalar()
            print(f"After sync: {after} rows in entry 457", flush=True)
            
            # Check faculty_department data
            dept_count = (await db2.execute(text(
                "SELECT COUNT(*) FROM kpi_multi_line_cells c "
                "JOIN kpi_multi_line_rows r ON c.row_id=r.id "
                "WHERE r.entry_id=457 AND c.sub_field_id IN (9869, 9870) "
                "AND (c.value_text IS NOT NULL OR c.value_number IS NOT NULL)"
            ))).scalar()
            print(f"faculty_department populated cells: {dept_count}", flush=True)

asyncio.run(main())

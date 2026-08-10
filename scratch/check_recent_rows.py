import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        query = text("""
            SELECT MIN(created_at), MAX(created_at), MIN(updated_at), MAX(updated_at)
            FROM kpi_multi_line_rows
            WHERE entry_id = 286;
        """)
        res = await conn.execute(query)
        times = res.fetchone()
        print("--- Entry 286 Timestamps ---")
        print(f"Created: {times[0]} to {times[1]}")
        print(f"Updated: {times[2]} to {times[3]}")
        
        # Check current time of DB
        res_time = await conn.execute(text("SELECT now()"))
        db_time = res_time.scalar()
        print(f"DB Time: {db_time}")

if __name__ == "__main__":
    asyncio.run(main())

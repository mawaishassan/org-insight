import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        query = text("""
            SELECT entry_id, field_id, COUNT(*) as c
            FROM kpi_multi_line_rows
            GROUP BY entry_id, field_id
            ORDER BY c DESC
            LIMIT 10;
        """)
        res = await conn.execute(query)
        rows = res.fetchall()
        print("--- Largest Entry-Field Multi-Line Grids ---")
        for r in rows:
            print(f"Entry ID: {r[0]} | Field ID: {r[1]} | Row Count: {r[2]}")

if __name__ == "__main__":
    asyncio.run(main())

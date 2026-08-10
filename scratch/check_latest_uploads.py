import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        query = text("""
            SELECT entry_id, field_id, COUNT(*), MAX(created_at) as m
            FROM kpi_multi_line_rows
            GROUP BY entry_id, field_id
            ORDER BY m DESC
            LIMIT 10;
        """)
        res = await conn.execute(query)
        rows = res.fetchall()
        print("--- Recently Updated/Created Grids ---")
        for r in rows:
            print(f"Entry ID: {r[0]} | Field ID: {r[1]} | Count: {r[2]} | Max Created At: {r[3]}")

if __name__ == "__main__":
    asyncio.run(main())

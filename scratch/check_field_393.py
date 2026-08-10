import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        query = text("""
            SELECT f.id, f.key, f.field_type, k.name as kpi_name
            FROM kpi_fields f
            JOIN kpis k ON f.kpi_id = k.id
            WHERE f.id = 393
        """)
        res = await conn.execute(query)
        r = res.fetchone()
        print("--- Field 393 Details ---")
        if r:
            print(f"Field ID: {r[0]} | Key: {r[1]} | Type: {r[2]} | KPI: {r[3]}")
        else:
            print("Not found")

if __name__ == "__main__":
    asyncio.run(main())

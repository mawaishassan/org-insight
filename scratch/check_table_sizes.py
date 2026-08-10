import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        for table in ["kpis", "kpi_entries", "kpi_fields", "kpi_multi_line_rows", "kpi_multi_line_cells"]:
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = res.scalar()
            print(f"Table: {table:25} | Count: {count}")

if __name__ == "__main__":
    asyncio.run(main())

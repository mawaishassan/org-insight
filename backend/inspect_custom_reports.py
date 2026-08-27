import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"

async def main():
    engine = create_async_engine(DATABASE_URL)
    async with engine.connect() as conn:
        print("--- Patents Submission KPI ---")
        res = await conn.execute(text("SELECT id, name FROM kpis WHERE name ILIKE '%patent%'"))
        kpis = res.fetchall()
        for k in kpis:
            print(f"KPI: {k[0]} - {k[1]}")
            res_fields = await conn.execute(text(f"SELECT id, name, key, field_type FROM kpi_fields WHERE kpi_id = {k[0]}"))
            for f in res_fields.fetchall():
                print(f"  Field: {f[0]} - Name: {f[1]} - Key: {f[2]} - Type: {f[3]}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())

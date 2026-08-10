import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        query = text("""
            SELECT id, key, name, field_type, config
            FROM kpi_field_sub_fields
            WHERE field_id = 261
            ORDER BY sort_order, id;
        """)
        res = await conn.execute(query)
        rows = res.fetchall()
        print("--- Sub Fields for Field 261 ---")
        for r in rows:
            print(f"ID: {r[0]} | Key: {r[1]} | Name: {r[2]} | Type: {r[3]}")
            print(f"Config: {r[4]}")
            print("-" * 50)

if __name__ == "__main__":
    asyncio.run(main())

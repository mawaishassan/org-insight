import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        # Check all fields of KPI of entry 5
        query = text("""
            SELECT f.id, f.key, f.field_type, COUNT(r.id)
            FROM kpi_entries e
            JOIN kpi_fields f ON e.kpi_id = f.kpi_id
            LEFT JOIN kpi_multi_line_rows r ON r.entry_id = e.id AND r.field_id = f.id
            WHERE e.id = 5
            GROUP BY f.id, f.key, f.field_type
            ORDER BY f.id;
        """)
        res = await conn.execute(query)
        rows = res.fetchall()
        print("--- Entry 5 Field Rows ---")
        for r in rows:
            print(f"Field ID: {r[0]} | Key: {r[1]:40} | Type: {r[2]:15} | Rows: {r[3]}")

if __name__ == "__main__":
    asyncio.run(main())

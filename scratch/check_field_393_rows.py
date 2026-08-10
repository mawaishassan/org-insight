import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        # Get rows
        query_rows = text("""
            SELECT r.id, r.row_index, r.search_text, r.created_at
            FROM kpi_multi_line_rows r
            WHERE r.entry_id = 5 AND r.field_id = 393
            ORDER BY r.row_index;
        """)
        res_rows = await conn.execute(query_rows)
        rows = res_rows.fetchall()
        print(f"--- Rows in Entry 5, Field 393 (Count: {len(rows)}) ---")
        for r in rows:
            print(f"Row ID: {r[0]} | Index: {r[1]} | Created: {r[3]}")
            
            # Get cells for this row
            query_cells = text("""
                SELECT sf.name, c.value_text, c.value_number, c.value_boolean, c.value_date, c.value_json
                FROM kpi_multi_line_cells c
                JOIN kpi_field_sub_fields sf ON c.sub_field_id = sf.id
                WHERE c.row_id = :row_id
                ORDER BY sf.sort_order, sf.id;
            """)
            res_cells = await conn.execute(query_cells, {"row_id": r[0]})
            cells = res_cells.fetchall()
            for c in cells:
                val = c[1] or c[2] or c[3] or c[4] or c[5]
                print(f"  Column: {c[0]:25} | Value: {val}")
            print("-" * 50)

if __name__ == "__main__":
    asyncio.run(main())

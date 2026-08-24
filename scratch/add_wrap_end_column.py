import asyncio
from app.core.database import engine
from sqlalchemy import text

async def run():
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE mli_text_extraction_rules ADD COLUMN IF NOT EXISTS wrap_end_symbol VARCHAR(50);"))
    print("SUCCESS: wrap_end_symbol column added.")

if __name__ == "__main__":
    asyncio.run(run())

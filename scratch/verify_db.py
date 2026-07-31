import asyncio
from app.core.database import engine
from sqlalchemy import text

async def test():
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT username, email, organization_id FROM users WHERE role = 'ORG_ADMIN'"))
        for r in res.fetchall():
            print(r)

if __name__ == "__main__":
    asyncio.run(test())

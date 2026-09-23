import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.core.database import engine
from sqlalchemy import text

async def check():
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT id, name, code FROM organizations;"))
        print("Organizations:", [dict(r._mapping) for r in res.fetchall()])
        
        users = await conn.execute(text("SELECT id, username, role, organization_id FROM users WHERE username = 'UstadexAdmin';"))
        print("User:", [dict(r._mapping) for r in users.fetchall()])

if __name__ == "__main__":
    asyncio.run(check())

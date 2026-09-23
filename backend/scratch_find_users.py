import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(User))).scalars().all()
        print("=== ALL USERS WITH UNIQUE KEYS OR MECH/HASEEB ===")
        for u in users:
            email = (u.email or "").lower()
            full_name = (u.full_name or "").lower()
            if u.unique_user_key or "mech" in email or "haseeb" in full_name:
                print(f"User ID: {u.id}, Email: '{u.email}', FullName: '{u.full_name}', Role: {u.role}, UniqueKey: '{u.unique_user_key}'")

if __name__ == "__main__":
    asyncio.run(main())

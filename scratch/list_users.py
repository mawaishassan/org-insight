import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import User, Organization

async def main():
    async with AsyncSessionLocal() as db:
        print("--- Organizations ---")
        orgs_res = await db.execute(select(Organization))
        orgs = orgs_res.scalars().all()
        for org in orgs:
            print(f"Org ID: {org.id}, Name: {org.name}, custom_periods: {org.custom_periods}")
            
        print("\n--- Users ---")
        users_res = await db.execute(select(User))
        users = users_res.scalars().all()
        for u in users:
            print(f"User ID: {u.id}, Username: {u.username}, Role: {u.role.value}, Org ID: {u.organization_id}")

if __name__ == "__main__":
    asyncio.run(main())

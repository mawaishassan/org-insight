"""
Create the first Super Admin user (no organization).
Run from backend/ with: python -m scripts.create_super_admin

IMPORTANT: Run migrations first so tables exist:
  cd backend && alembic upgrade head
"""

import asyncio
import getpass
import sys
from pathlib import Path

# Ensure app is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError
from app.core.database import AsyncSessionLocal
from app.core.models import User
from app.core.models import UserRole
from app.core.security import get_password_hash


async def main() -> None:
    username = input("Super Admin username: ").strip()
    if not username:
        print("Username required.")
        return
    password = getpass.getpass("Password: ")
    if len(password) < 8:
        print("Password must be at least 8 characters.")
        return

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(select(User).where(User.username == username, User.organization_id.is_(None)))
        except ProgrammingError as e:
            if "does not exist" in str(e.orig) or "relation" in str(e.orig).lower():
                print("Database tables are missing. Run migrations first:")
                print("  cd backend && alembic upgrade head")
                return
            raise
        existing = result.scalar_one_or_none()
        if existing:
            print(f"User '{username}' already exists. Exiting.")
            return
        user = User(
            organization_id=None,
            username=username,
            hashed_password=get_password_hash(password),
            role=UserRole.SUPER_ADMIN,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        print(f"Super Admin '{username}' created. You can log in at /api/auth/login.")


if __name__ == "__main__":
    asyncio.run(main())

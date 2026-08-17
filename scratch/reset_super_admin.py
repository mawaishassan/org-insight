import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import User, UserRole
from app.core.security import get_password_hash

async def main():
    async with AsyncSessionLocal() as db:
        # Find user with role SUPER_ADMIN
        res = await db.execute(select(User).where(User.role == UserRole.SUPER_ADMIN))
        user = res.scalar_one_or_none()
        if user:
            old_username = user.username
            user.username = "UstadexAdmin"
            user.hashed_password = get_password_hash("ustadex9876")
            await db.commit()
            print(f"Super Admin user '{old_username}' updated to username 'UstadexAdmin' and password 'ustadex9876' successfully!")
        else:
            print("No Super Admin user found in the database.")

if __name__ == "__main__":
    asyncio.run(main())

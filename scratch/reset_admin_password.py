import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import User
from app.core.security import get_password_hash

async def main():
    async with AsyncSessionLocal() as db:
        for username in ["UstadexAdmin", "uet_admin", "admin"]:
            res = await db.execute(select(User).where(User.username == username))
            user = res.scalar_one_or_none()
            if user:
                user.hashed_password = get_password_hash("admin123")
                print(f"Password for '{username}' reset to 'admin123' successfully!")
        await db.commit()

if __name__ == "__main__":
    asyncio.run(main())

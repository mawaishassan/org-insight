import asyncio
from app.core.database import AsyncSessionLocal
from app.auth.captcha import create_captcha_challenge

async def main():
    try:
        async with AsyncSessionLocal() as db:
            result = await create_captcha_challenge(db)
            print("SUCCESS:", result)
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())

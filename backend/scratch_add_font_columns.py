import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings

async def main():
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        print("Adding columns to custom_reports table...")
        try:
            await db.execute(text("ALTER TABLE custom_reports ADD COLUMN scalar_font_family VARCHAR(255) DEFAULT 'Inter' NOT NULL;"))
            print("Added scalar_font_family column successfully.")
        except Exception as e:
            print("Failed or already exists for scalar_font_family:", e)
            
        try:
            await db.execute(text("ALTER TABLE custom_reports ADD COLUMN mli_font_family VARCHAR(255) DEFAULT 'Inter' NOT NULL;"))
            print("Added mli_font_family column successfully.")
        except Exception as e:
            print("Failed or already exists for mli_font_family:", e)
            
        await db.commit()
        print("Done.")

if __name__ == "__main__":
    asyncio.run(main())

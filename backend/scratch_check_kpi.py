import asyncio
import json
from sqlalchemy import select
from app.core.database import get_db
from app.core.models import KPI, KPIField, KPIFieldSubField
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, selectinload
from app.core.config import get_settings

async def main():
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        # Fetch KPI matching Submission Summary
        result = await db.execute(
            select(KPI)
            .where(KPI.name.like("%Submission Summary%"))
            .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
        )
        kpis = result.scalars().all()
        for kpi in kpis:
            print(f"KPI ID: {kpi.id}, Name: {kpi.name}")
            for field in kpi.fields:
                print(f"  Field: {field.name} (Key: {field.key}, Type: {field.field_type})")
                if field.sub_fields:
                    for sf in field.sub_fields:
                        print(f"    SubField: {sf.name} (Key: {sf.key}, Type: {sf.field_type})")
                        if sf.config:
                            print(f"      Config: {sf.config}")

if __name__ == "__main__":
    asyncio.run(main())

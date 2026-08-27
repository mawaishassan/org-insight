import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KpiBulkUploadTask

async def dump_tasks():
    print("Dumping bulk upload tasks from database...")
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(KpiBulkUploadTask).order_by(KpiBulkUploadTask.completed_at.desc().nulls_first()).limit(10))
        tasks = res.scalars().all()
        if not tasks:
            print("No tasks found in kpi_bulk_upload_tasks table.")
            return
        for t in tasks:
            print(f"Task ID: {t.id}")
            print(f"  Status: {t.status}")
            print(f"  Progress: {t.progress_percent}%")
            print(f"  Processed rows: {t.processed_rows} / {t.total_rows}")
            print(f"  Error message: {t.error_message}")
            print(f"  Validation errors count: {len(t.validation_errors or [])}")
            print(f"  Completed at: {t.completed_at}")
            print("-" * 50)

if __name__ == "__main__":
    asyncio.run(dump_tasks())

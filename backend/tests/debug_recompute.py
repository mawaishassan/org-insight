import sys
import asyncio
sys.path.insert(0, ".")
from app.core.database import AsyncSessionLocal
from app.entries.service import recompute_mli_formula_subfields
from app.core.models import KPIField
from sqlalchemy import select, func
from app.core.models import KpiMultiLineRow

async def run_and_commit():
    async with AsyncSessionLocal() as db:
        entry_id = 451
        field_id = 680
        org_id = 3

        print("Starting recomputation and database save...")
        await recompute_mli_formula_subfields(db, entry_id=entry_id, org_id=org_id, field_id=field_id)
        await db.commit()
        print("Database transaction committed successfully!")

        res = await db.execute(select(func.count(KpiMultiLineRow.id)).where(KpiMultiLineRow.field_id == 680))
        print("Rows count after commit:", res.scalar())

asyncio.run(run_and_commit())

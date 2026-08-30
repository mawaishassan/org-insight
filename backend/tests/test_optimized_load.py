import sys
import asyncio
sys.path.insert(0, ".")
from app.core.database import AsyncSessionLocal
from app.core.models import KPIField, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField
from sqlalchemy import select, func

async def test():
    async with AsyncSessionLocal() as db:
        # Find a field with rows
        res = await db.execute(
            select(KpiMultiLineRow.entry_id, KpiMultiLineRow.field_id, func.count(KpiMultiLineRow.id))
            .group_by(KpiMultiLineRow.entry_id, KpiMultiLineRow.field_id)
            .order_by(func.count(KpiMultiLineRow.id).desc())
            .limit(1)
        )
        item = res.first()
        if not item:
            print("No multi line rows found in DB")
            return
        entry_id, field_id, count = item
        print(f"Testing on entry_id={entry_id}, field_id={field_id} with {count} rows")

        import time
        t0 = time.time()
        
        # Test optimized fetch
        q = (
            select(
                KpiMultiLineRow.id,
                KpiMultiLineRow.row_index,
                KPIFieldSubField.key,
                KpiMultiLineCell.value_text,
                KpiMultiLineCell.value_number,
                KpiMultiLineCell.value_json,
                KpiMultiLineCell.value_boolean,
                KpiMultiLineCell.value_date
            )
            .join(KpiMultiLineCell, KpiMultiLineCell.row_id == KpiMultiLineRow.id)
            .join(KPIFieldSubField, KPIFieldSubField.id == KpiMultiLineCell.sub_field_id)
            .where(KpiMultiLineRow.entry_id == entry_id, KpiMultiLineRow.field_id == field_id)
            .order_by(KpiMultiLineRow.row_index)
        )
        res = await db.execute(q)
        flat_results = res.all()
        
        rows_map = {}
        for r_id, r_idx, sf_key, val_text, val_number, val_json, val_boolean, val_date in flat_results:
            if r_idx not in rows_map:
                rows_map[r_idx] = {}
            val = None
            if val_json is not None:
                val = val_json
            elif val_text is not None:
                val = val_text
            elif val_number is not None:
                val = val_number
            elif val_boolean is not None:
                val = val_boolean
            elif val_date is not None:
                val = val_date.isoformat()
            rows_map[r_idx][str(sf_key)] = val
            
        out = [rows_map[idx] for idx in sorted(rows_map.keys())]
        t1 = time.time()
        print(f"Loaded {len(out)} rows via flat query in {t1 - t0:.3f} seconds!")

if __name__ == "__main__":
    asyncio.run(test())

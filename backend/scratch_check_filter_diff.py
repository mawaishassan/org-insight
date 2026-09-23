import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.service import _load_multi_line_items_rows_batch
from app.core.models import KPIField
from app.entries.multi_item_filters import row_passes_filters

async def main():
    async with AsyncSessionLocal() as db:
        kfield = await db.get(KPIField, 624)
        res = await _load_multi_line_items_rows_batch(db, entry_ids=[401], field=kfield, custom_report_id=None, current_user=None)
        rows = res.get(401, [])
        cs_rows = [r for r in rows if r.get('department') == 'Computer Science']
        
        fall_gt_0 = [r for r in cs_rows if float(r.get('total_survays_fall_2025') or 0) > 0]
        print(f"Total CS rows: {len(cs_rows)}")
        print(f"CS rows with total_survays_fall_2025 > 0: {len(fall_gt_0)}")

        filters_34 = {'_version': 2, 'conditions': [{'field': 'total_survays_fall_2025', 'op': 'neq', 'value': '0.0'}]}
        passed_34 = [r for r in cs_rows if row_passes_filters(r, filters_34)]
        print(f"CS rows passing filters_34: {len(passed_34)}")

        diff = [r for r in fall_gt_0 if r not in passed_34]
        print(f"Difference ({len(diff)} rows):")
        for r in diff:
            print(f"  faculty='{r.get('faculty_name')}', fall_surveys='{r.get('total_survays_fall_2025')}', type={type(r.get('total_survays_fall_2025'))}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPIField, KPIFieldSubField, KpiMultiLineRow, KpiMultiLineCell, User, CustomReportAssignment
)
from sqlalchemy import select, func, or_, and_

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)
        u_key = user_147.unique_user_key
        print(f"User 147 unique_user_key: '{u_key}'")

        # Let's inspect subfields of field 624
        sfs = (await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == 624))).scalars().all()
        print(f"\nSubfields of field 624 (total {len(sfs)}):")
        for sf in sfs:
            print(f"  ID={sf.id}, Key='{sf.key}', Name='{sf.name}', Type='{getattr(sf, 'field_type', None)}'")

        # In Report 34, target_sf_key was 'department'
        dept_sf = [sf for sf in sfs if sf.key == 'department']
        if dept_sf:
            target_field_id = dept_sf[0].id
            print(f"\nTarget field id for 'department': {target_field_id}")
            
            # Let's check cells for this target_field_id in entry 401
            stmt = (
                select(KpiMultiLineCell.value_text, KpiMultiLineCell.value_number, func.count(KpiMultiLineCell.id))
                .join(KpiMultiLineRow, KpiMultiLineCell.row_id == KpiMultiLineRow.id)
                .where(
                    KpiMultiLineRow.entry_id == 401,
                    KpiMultiLineRow.field_id == 624,
                    KpiMultiLineCell.sub_field_id == target_field_id
                )
                .group_by(KpiMultiLineCell.value_text, KpiMultiLineCell.value_number)
            )
            cells = (await db.execute(stmt)).all()
            print(f"\nDistinct cell values for subfield {target_field_id} in entry 401:")
            for val_text, val_num, count in cells:
                if val_text and "computer" in val_text.lower():
                    print(f"  val_text='{val_text}', val_num={val_num}, count={count}")
                elif val_num:
                    print(f"  val_text='{val_text}', val_num={val_num}, count={count}")

        # Now let's see why the query in lines 490-530 returned 0 rows!
        # Let's run the exact query from service.py:
        stmt = (
            select(KpiMultiLineRow.id, KpiMultiLineRow.entry_id, KpiMultiLineRow.row_index)
            .where(
                KpiMultiLineRow.entry_id == 401,
                KpiMultiLineRow.field_id == 624,
            )
        )
        stmt = stmt.join(
            KpiMultiLineCell,
            and_(
                KpiMultiLineCell.row_id == KpiMultiLineRow.id,
                KpiMultiLineCell.sub_field_id == target_field_id
            )
        )
        val_str = str(u_key).strip()
        val_lower = val_str.lower()
        variants = [val_str]
        if val_lower.startswith("department of "):
            variants.append(val_str[len("department of "):].strip())
        elif val_lower.endswith(" department"):
            variants.append(val_str[:-len(" department")].strip())
        else:
            variants.append(f"Department of {val_str}")
            variants.append(f"{val_str} Department")
        variants = list(dict.fromkeys(variants))
        print(f"\nVariants for '{val_str}': {variants}")

        conditions = []
        for v in variants:
            conditions.append(KpiMultiLineCell.value_text == v)
            conditions.append(func.lower(KpiMultiLineCell.value_text) == v.lower())

        stmt = stmt.where(or_(*conditions))
        matched_rows = (await db.execute(stmt)).all()
        print(f"\nMatched rows by exact service.py query: {len(matched_rows)}")

if __name__ == "__main__":
    asyncio.run(main())

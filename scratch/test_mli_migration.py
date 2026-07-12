import asyncio
import os
import sys
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Ensure app imports work
repo_root = Path(__file__).resolve().parents[1]
backend_dir = repo_root / "backend"
sys.path.insert(0, str(backend_dir))

from app.core.models import (
    FieldType, KPI, KPIEntry, KPIField, KPIFieldSubField, KpiMultiLineRow, KpiMultiLineCell, KPIFieldValue
)
from app.fields.service import update_field, create_field
from app.fields.schemas import KPIFieldUpdate, KPIFieldSubFieldCreate, KPIFieldCreate
from app.entries.service import replace_multi_line_items_rows, load_multi_line_items_rows

async def test_migration():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    
    async with Session() as s:
        # 1. Find a KPI and organization to test with
        kpi_res = await s.execute(select(KPI).limit(1))
        kpi = kpi_res.scalar_one_or_none()
        if not kpi:
            print("No KPI found in DB!")
            return
        
        org_id = kpi.organization_id
        kpi_id = kpi.id
        print(f"Using KPI: {kpi.name} (id={kpi_id}) in Org ID={org_id}")
        
        # 2. Create an MLI Field
        field_create_data = KPIFieldCreate(
            kpi_id=kpi_id,
            name="Test MLI Field",
            key="test_mli_field",
            field_type=FieldType.multi_line_items,
            sub_fields=[
                KPIFieldSubFieldCreate(name="Col A Text", key="col_a", field_type=FieldType.single_line_text),
                KPIFieldSubFieldCreate(name="Col B Bool", key="col_b", field_type=FieldType.boolean),
                KPIFieldSubFieldCreate(name="Col C Number", key="col_c", field_type=FieldType.number),
            ]
        )
        
        field = await create_field(s, org_id, field_create_data)
        
        # Query field with selectinload to avoid lazy load issues
        field_res = await s.execute(
            select(KPIField)
            .where(KPIField.id == field.id)
            .options(selectinload(KPIField.sub_fields))
        )
        field = field_res.scalar_one()
        
        print(f"Created MLI field id={field.id} with subfields: {[sf.key for sf in field.sub_fields]}")
        
        # Find or create a KPIEntry
        entry_res = await s.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == kpi_id, KPIEntry.organization_id == org_id).limit(1)
        )
        entry = entry_res.scalar_one_or_none()
        if not entry:
            entry = KPIEntry(
                organization_id=org_id,
                kpi_id=kpi_id,
                year=2026,
                is_draft=True
            )
            s.add(entry)
            await s.flush()
        
        print(f"Using Entry id={entry.id}")
        
        # 3. Add some rows of data
        test_rows = [
            {"col_a": "Hello", "col_b": True, "col_c": 12.34},
            {"col_a": "World", "col_b": False, "col_c": 56.78},
        ]
        await replace_multi_line_items_rows(s, entry_id=entry.id, field=field, rows=test_rows)
        
        loaded = await load_multi_line_items_rows(s, entry_id=entry.id, field=field)
        print("Loaded initial rows:", loaded)
        
        # 4. Now modify the schema using update_field
        # We will:
        # - Add new subfield: "col_d" (Number) with default value 9.99
        # - Change type of col_c (Number -> Text, which is a compatible conversion)
        # - Add a formula subfield: "col_e" which computes col_d * 2
        # - Change type of col_b (Boolean -> Number, which is an INCOMPATIBLE conversion -> should clear data!)
        # - Keep Col A intact
        sub_fields_update = [
            KPIFieldSubFieldCreate(id=field.sub_fields[0].id, name="Col A Text", key="col_a", field_type=FieldType.single_line_text),
            KPIFieldSubFieldCreate(id=field.sub_fields[1].id, name="Col B Bool", key="col_b", field_type=FieldType.number), # Boolean -> Number (incompatible)
            KPIFieldSubFieldCreate(id=field.sub_fields[2].id, name="Col C String", key="col_c", field_type=FieldType.single_line_text),
            KPIFieldSubFieldCreate(name="Col D Defaulted", key="col_d", field_type=FieldType.number, config={"default_value": 9.99}),
            KPIFieldSubFieldCreate(name="Col E Formula", key="col_e", field_type=FieldType.formula, config={"formula_expression": "CurrentRow.col_d * 2"}),
        ]
        
        update_data = KPIFieldUpdate(
            sub_fields=sub_fields_update
        )
        
        print("Running update_field with schema changes...")
        updated_field = await update_field(s, field.id, org_id, update_data)
        
        # Refresh and print
        loaded_after = await load_multi_line_items_rows(s, entry_id=entry.id, field=updated_field)
        print("Loaded after migration:", loaded_after)
        
        # Verify results
        assert loaded_after[0]["col_a"] == "Hello"
        assert loaded_after[0]["col_b"] is None  # Incompatible conversion, cleared!
        assert loaded_after[0]["col_c"] == "12.34" # Converted to String
        assert loaded_after[0]["col_d"] == 9.99   # Default value populated
        assert loaded_after[0]["col_e"] == 19.98  # Formula evaluated (9.99 * 2)
        
        print("All assertions passed successfully!")
        
        # Clean up database changes (rollback)
        print("Rolling back test transactions...")
        await s.rollback()

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(test_migration())

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIEntry, KPIFieldValue, User
from app.entries.load_joined import load_joined_scalar_values
from app.entries.joined_sync import sync_joined_kpi_physical_data
from app.widget_data.service import _resolve_kpi_card_single_value, evaluate_kpi_scalar_formula_field
from app.reports.service import generate_report_data, generate_kpi_pdf_report, generate_kpi_docx_report

async def main():
    async with AsyncSessionLocal() as db:
        print("================ Testing Joined MLI Scalar Formula Field ================")
        # 1. Fetch KPI 317 ("Links")
        kpi = await db.get(KPI, 317)
        print(f"Target KPI: ID={kpi.id}, Name='{kpi.name}', is_joined={kpi.is_joined}")
        f_formula = next((f for f in kpi.fields if f.id == 744), None)
        print(f"Formula Field: ID={f_formula.id}, key='{f_formula.key}', formula='{f_formula.formula_expression}'")

        # 2. Get entry
        ent_res = await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == 317))
        entry = ent_res.scalars().first()
        print(f"Entry: ID={entry.id}, Year={entry.year}, Period='{entry.period_key}'")

        # 3. Test load_joined_scalar_values
        print("\n--- Test 1: load_joined_scalar_values ---")
        virtual_fvs = await load_joined_scalar_values(db, joined_kpi=kpi, entry_id=entry.id)
        fv_744 = next((fv for fv in virtual_fvs if fv.field_id == 744), None)
        assert fv_744 is not None, "Field 744 not found in load_joined_scalar_values"
        print(f"PASS: Field 744 returned with value_number = {fv_744.value_number}")
        assert fv_744.value_number == 74, f"Expected 74, got {fv_744.value_number}"

        # 4. Test sync_joined_kpi_physical_data
        print("\n--- Test 2: sync_joined_kpi_physical_data ---")
        synced_rows = await sync_joined_kpi_physical_data(db, kpi, year=entry.year, period_key=entry.period_key)
        await db.commit()
        print(f"Synced {synced_rows} MLI rows.")
        # Check database table KPIFieldValue
        db_fv_res = await db.execute(
            select(KPIFieldValue).where(KPIFieldValue.entry_id == entry.id, KPIFieldValue.field_id == 744)
        )
        db_fv = db_fv_res.scalar_one_or_none()
        assert db_fv is not None, "Field 744 not persisted in KPIFieldValue table"
        print(f"PASS: Database KPIFieldValue record found with value_number = {db_fv.value_number}")
        assert db_fv.value_number == 74, f"Expected 74 in DB, got {db_fv.value_number}"

        # 5. Test Single Value Dashboard Card
        print("\n--- Test 3: Single Value Dashboard Card ---")
        admin_res = await db.execute(select(User).limit(1))
        user = admin_res.scalar_one()
        card_widget = {
            "type": "kpi_card_single_value",
            "kpi_id": 317,
            "year": 2026,
            "period_key": "",
            "source_mode": "field",
            "field_key": "total_research_links",
        }
        _meta, payload, _rev = await _resolve_kpi_card_single_value(
            db, user=user, org_id=entry.organization_id, w=card_widget
        )
        print(f"Card single value payload: {payload}")
        assert payload.get("numeric") == 74, f"Expected 74, got {payload.get('numeric')}"
        print("PASS: Single Value Card correctly returned 74!")

        # 6. Test Reports (HTML / Visual Designer)
        print("\n--- Test 4: PDF and DOCX Report Generation ---")
        pdf_bytes = await generate_kpi_pdf_report(
            db,
            organization_id=entry.organization_id,
            kpi_id=317,
            year=2026,
            period_key="",
            configuration={},
            requesting_user_id=user.id,
        )
        print(f"PDF Report generated successfully ({len(pdf_bytes)} bytes)")
        assert len(pdf_bytes) > 0, "PDF generation failed"

        docx_bytes = await generate_kpi_docx_report(
            db,
            organization_id=entry.organization_id,
            kpi_id=317,
            year=2026,
            period_key="",
            configuration={},
            requesting_user_id=user.id,
        )
        print(f"DOCX Report generated successfully ({len(docx_bytes)} bytes)")
        assert len(docx_bytes) > 0, "DOCX generation failed"

        print("\n================ ALL TESTS PASSED SUCCESSFULLY! ================")

if __name__ == "__main__":
    asyncio.run(main())

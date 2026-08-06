import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import AsyncSessionLocal
from app.core.models import CustomReport, KPIEntry, KPIField, KPIFieldValue, CustomReportSection, CustomReportField

async def main():
    async with AsyncSessionLocal() as db:
        # Load custom report 1 with relationships eager loaded
        stmt = (
            select(CustomReport)
            .where(CustomReport.id == 1)
            .options(
                selectinload(CustomReport.sections)
                .selectinload(CustomReportSection.fields)
                .selectinload(CustomReportField.kpi_field)
            )
        )
        res = await db.execute(stmt)
        report = res.scalar_one_or_none()
        if not report:
            print("Custom report 1 not found!")
            return
        
        print(f"Report ID: {report.id}, Name: {report.name}")
        for s_idx, sec in enumerate(report.sections):
            print(f"Section {s_idx+1}: {sec.custom_header} (KPI ID: {sec.kpi_id})")
            for f_idx, field in enumerate(sec.fields):
                kfield = field.kpi_field
                print(f"  Field {s_idx+1}.{f_idx+1}: ID={kfield.id}, Key={kfield.key}, Name={kfield.name}, Type={kfield.field_type.value if hasattr(kfield.field_type, 'value') else kfield.field_type}")

        # Check entries for organization 3, year 2026
        print("\n=== Entries for Org 3, Year 2026 ===")
        stmt_entries = select(KPIEntry).where(KPIEntry.organization_id == 3, KPIEntry.year == 2026)
        res_entries = await db.execute(stmt_entries)
        entries = res_entries.scalars().all()
        for e in entries:
            print(f"Entry ID: {e.id}, KPI ID: {e.kpi_id}, is_draft: {e.is_draft}, period_key: {e.period_key}")
            # Fetch field values
            stmt_fvs = select(KPIFieldValue).where(KPIFieldValue.entry_id == e.id)
            res_fvs = await db.execute(stmt_fvs)
            fvs = res_fvs.scalars().all()
            for fv in fvs:
                # Get field details
                kfield = await db.get(KPIField, fv.field_id)
                print(f"  Field {kfield.key} ({kfield.name}): number={fv.value_number}, text={fv.value_text}")

if __name__ == "__main__":
    asyncio.run(main())

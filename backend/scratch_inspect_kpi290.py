import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    CustomReport, CustomReportSection, CustomReportField, KPI, KPIField, KPIFieldSubField,
    KPIEntry, KpiMultiLineRow, KpiMultiLineCell
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== Custom Reports 36 & 37 KPI references ===")
        for r_id in [36, 37]:
            rep = (await db.execute(select(CustomReport).where(CustomReport.id == r_id))).scalar_one_or_none()
            sections = (await db.execute(select(CustomReportSection).where(CustomReportSection.custom_report_id == r_id))).scalars().all()
            print(f"Report {r_id} ('{rep.name}'):")
            for s in sections:
                kpi = (await db.execute(select(KPI).where(KPI.id == s.kpi_id))).scalar_one_or_none()
                fields = (await db.execute(select(CustomReportField).where(CustomReportField.custom_report_section_id == s.id))).scalars().all()
                print(f"  Section ID {s.id}: kpi_id={s.kpi_id} ('{kpi.name if kpi else None}')")
                for f in fields:
                    kfield = (await db.execute(select(KPIField).where(KPIField.id == f.kpi_field_id))).scalar_one_or_none()
                    print(f"    CustomReportField ID {f.id}: label='{getattr(f, 'label', getattr(f, 'name', ''))}', kpi_field_id={f.kpi_field_id} (kpi_id={kfield.kpi_id if kfield else None}, field_type='{kfield.field_type if kfield else None}')")

        print("\n=== Compare KPI 277 vs KPI 290 ===")
        for k_id in [277, 290]:
            kpi = (await db.execute(select(KPI).where(KPI.id == k_id))).scalar_one_or_none()
            print(f"\nKPI {k_id}: name='{kpi.name if kpi else None}'")
            entries = (await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == k_id))).scalars().all()
            for e in entries:
                print(f"  Entry ID {e.id}: org_id={e.organization_id}, year={e.year}, is_draft={e.is_draft}")
                rows = (await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id))).scalars().all()
                print(f"    Total rows: {len(rows)}")
                for r in rows:
                    cells = (await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))).scalars().all()
                    c_dict = {}
                    for c in cells:
                        sf = (await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.id == c.sub_field_id))).scalar_one_or_none()
                        sf_name = sf.name if sf else str(c.sub_field_id)
                        c_dict[sf_name] = c.value_text or c.value_number
                    dept = str(c_dict.get("Department Name") or c_dict.get("Department ID") or "")
                    if "Mechanical" in dept or str(c_dict.get("Department ID")) in ("120", "120.0"):
                        print(f"    Row ID {r.id} for Mechanical in Entry {e.id}:")
                        for k, v in c_dict.items():
                            print(f"       {k}: {v}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data

async def main():
    async with AsyncSessionLocal() as db:
        # Simulate export data generation for Calendrical Year
        data = await generate_custom_report_data(
            db, 5, 3, year="2026", include_drafts=False, preview=False, include_attachments=True, by_default=False, period_type="Calendrical Year"
        )
        print("Resolved Year in data:", data.get("year"))
        
        # Look for section with KPI 256
        sections = data.get("sections") or []
        for sec in sections:
            if sec.get("kpi_id") == 256:
                print(f"Section {sec.get('section_id')}")
                for f in sec.get("fields", []):
                    if f.get("field_type") == "multi_line_items":
                        print(f"  Field {f.get('field_name')} rows:")
                        rows = f.get("value_items") or []
                        print(f"    Total rows returned: {len(rows)}")
                        for r in rows[:5]:
                            print(f"      {r}")
                    else:
                        print(f"  Field {f.get('field_name')}: value={f.get('value')}")

if __name__ == '__main__':
    asyncio.run(main())

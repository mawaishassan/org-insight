import asyncio
from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data

async def main():
    async with AsyncSessionLocal() as db:
        # Run report generation
        data = await generate_custom_report_data(
            db, 5, 3, year="2026", include_drafts=False, preview=True, include_attachments=True, by_default=True
        )
        if not data:
            print("No report data returned!")
            return
            
        print("Generated year display:", data.get("year"))
        
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

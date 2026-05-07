"""
Quick diagnostic: count KPI formula fields that use KPI_FIELD(...).

Usage:
  python -m scripts.check_kpi_field_usage
"""

import asyncio

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.models import KPIField, FieldType


async def main() -> None:
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(KPIField).where(KPIField.field_type == FieldType.formula))
        fields = list(res.scalars().all())
        hits = [f for f in fields if "KPI_FIELD" in (getattr(f, "formula_expression", "") or "")]
        print(f"[kpi-field-scan] formula_fields={len(fields)} kpi_field_hits={len(hits)}")
        for f in hits[:10]:
            expr = (f.formula_expression or "").replace("\n", " ").strip()
            print(f"[kpi-field-scan] kpi_id={f.kpi_id} field_key={f.key} expr={expr[:160]}")


if __name__ == "__main__":
    asyncio.run(main())


import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _load_database_url() -> str | None:
    # Try env var first
    url = os.environ.get("DATABASE_URL")
    if url:
        return url.strip().strip('"')
    # Then backend/.env
    env_path = Path(__file__).resolve().parents[1] / "backend" / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == "DATABASE_URL":
            return v.strip().strip('"')
    return None


async def main() -> None:
    url = _load_database_url()
    print("DATABASE_URL found:", bool(url))
    if not url:
        print("Set DATABASE_URL env var or add it to backend/.env")
        return

    # Ensure `app.*` imports work when running from repo root.
    repo_root = Path(__file__).resolve().parents[1]
    backend_dir = repo_root / "backend"
    sys.path.insert(0, str(backend_dir))

    from app.core.models import FieldType, KPI, KPIEntry, KPIField, KPIFieldValue

    org_id = int(os.environ.get("ORG_ID", "3"))
    kpi_id = int(os.environ.get("KPI_ID", "177"))
    year = int(os.environ.get("YEAR", "2026"))

    engine = create_async_engine(url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        entry = (
            await s.execute(
                select(KPIEntry).where(
                    KPIEntry.organization_id == org_id,
                    KPIEntry.kpi_id == kpi_id,
                    KPIEntry.year == year,
                )
            )
        ).scalars().first()
        print(f"entry id: {getattr(entry, 'id', None)}")
        if not entry:
            return

        kpi = (await s.execute(select(KPI).where(KPI.id == kpi_id))).scalars().first()
        print("kpi:", getattr(kpi, "id", None), getattr(kpi, "name", None), "year:", getattr(kpi, "year", None))

        fields = (
            await s.execute(
                select(KPIField).where(KPIField.kpi_id == kpi_id).order_by(KPIField.sort_order, KPIField.id)
            )
        ).scalars().all()
        f_by_id = {f.id: f for f in fields}

        fvs = (await s.execute(select(KPIFieldValue).where(KPIFieldValue.entry_id == entry.id))).scalars().all()
        print("field_values:", len(fvs))

        for fv in fvs:
            f = f_by_id.get(fv.field_id)
            if not f:
                continue
            if f.field_type == FieldType.multi_line_items:
                vj = fv.value_json
                print(f"multi_line field '{f.key}': value_json type={type(vj).__name__}")
                if isinstance(vj, list):
                    print("  rows:", len(vj))
                    if vj and isinstance(vj[0], dict):
                        keys = sorted(vj[0].keys())
                        print("  first row keys:", keys)
                else:
                    print("  value_json:", vj)
            elif f.field_type == FieldType.formula:
                print(f"formula field '{f.key}': expr={f.formula_expression!r} stored_value={fv.value_number!r}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())


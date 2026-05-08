"""
Profile report preview generation without HTTP/auth.

Usage (from repo root):
  python -m backend.scripts.profile_report_preview --template-id 9 --org-id 3 --year 2026

This calls the same backend functions used by /reports/templates/{id}/preview and prints the
[report-profile] lines when REPORT_PREVIEW_PROFILE=true.
"""

import argparse
import asyncio
import os
import time

from app.core.database import AsyncSessionLocal
from app.reports.service import generate_report_data, render_report_html_with_template


async def _run(template_id: int, org_id: int, year: int) -> None:
    # Ensure profiling is enabled for this run unless explicitly turned off.
    os.environ.setdefault("REPORT_PREVIEW_PROFILE", "true")

    async with AsyncSessionLocal() as db:
        t0 = time.perf_counter()
        data = await generate_report_data(db, template_id, org_id, year=year, include_drafts=True)
        t1 = time.perf_counter()
        if not data:
            raise SystemExit("No report data returned (template/org/year not found?)")
        html = await render_report_html_with_template(
            db,
            template_id,
            org_id,
            year=year,
            body_template_override=None,
            include_drafts=True,
            report_data=data,
        )
        t2 = time.perf_counter()
        if html is None:
            raise SystemExit("Render returned no HTML")
        print(f"[profile-script] generate_report_data_ms={(t1 - t0) * 1000:.1f}")
        print(f"[profile-script] render_html_ms={(t2 - t1) * 1000:.1f}")
        print(f"[profile-script] total_ms={(t2 - t0) * 1000:.1f}")
        print(f"[profile-script] html_chars={len(html)}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--template-id", type=int, required=True)
    p.add_argument("--org-id", type=int, required=True)
    p.add_argument("--year", type=int, required=True)
    args = p.parse_args()
    asyncio.run(_run(args.template_id, args.org_id, args.year))


if __name__ == "__main__":
    main()


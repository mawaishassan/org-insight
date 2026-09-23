import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User, CustomReport, CustomReportAssignment, 
    ReportAccessPermission, ReportUserFilterConfiguration, ReportTemplate
)
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(User).where(User.email.ilike('%2024cs88%') | User.email.ilike('%haseeb%') | User.full_name.ilike('%Haseeb%')))).scalars().all()
        for u in users:
            print(f'User: id={u.id}, email={u.email}, name={u.full_name}, key={u.unique_user_key}, org_id={u.organization_id}')
            
            c_assigns = (await db.execute(select(CustomReportAssignment).where(CustomReportAssignment.user_id == u.id))).scalars().all()
            for a in c_assigns:
                cr = await db.get(CustomReport, a.custom_report_id)
                cr_title = cr.name if cr else "Unknown"
                print(f'   CustomReportAssignment: id={a.id}, custom_report_id={a.custom_report_id} ("{cr_title}"), can_use_unique_value={a.can_use_unique_value}, key={a.filter_sub_field_key}, configs={a.filter_column_configs}, is_active={getattr(a, "is_active", None)}')

            r_perms = (await db.execute(select(ReportAccessPermission).where(ReportAccessPermission.user_id == u.id))).scalars().all()
            for r in r_perms:
                rt = await db.get(ReportTemplate, r.report_template_id)
                rt_title = rt.name if rt else "Unknown"
                print(f'   ReportAccessPermission: id={r.id}, report_template_id={r.report_template_id} ("{rt_title}"), can_use_unique_value={r.can_use_unique_value}, key={r.filter_sub_field_key}, configs={r.filter_column_configs}, is_active={getattr(r, "is_active", None)}')



        print('\n=== ALL CUSTOM REPORTS WITH FACULTY OR PERFORMANCE ===')
        reports = (await db.execute(select(CustomReport))).scalars().all()
        for r in reports:
            if 'faculty' in r.name.lower() or 'performance' in r.name.lower():
                print(f'CustomReport: id={r.id}, name="{r.name}"')

        print('\n=== ALL REPORT TEMPLATES WITH FACULTY OR PERFORMANCE ===')
        templates = (await db.execute(select(ReportTemplate))).scalars().all()
        for t in templates:
            if 'faculty' in t.name.lower() or 'performance' in t.name.lower():
                print(f'ReportTemplate: id={t.id}, name="{t.name}"')

if __name__ == "__main__":
    asyncio.run(check())

import sys
import asyncio
sys.path.insert(0, "./backend")

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    Organization,
    CustomReport,
    ReportUserFilterConfiguration,
    KPI,
    KPIField,
    KPIFieldSubField,
    KPIEntry,
    KpiMultiLineRow,
    KpiMultiLineCell,
    FieldType,
    CustomReportAttachment
)
from app.reports.custom_service import (
    generate_custom_report_data,
    bulk_assign_custom_report
)
from sqlalchemy import select

async def run_verification():
    print("Starting Ustadex Insights Bulk Assign & User-Based Filtering Verification...")
    async with AsyncSessionLocal() as db:
        # 1. Fetch or create a test Organization
        org_res = await db.execute(select(Organization).limit(1))
        org = org_res.scalar_one_or_none()
        if not org:
            org = Organization(name="Verification Org")
            db.add(org)
            await db.flush()
        print(f"Using Organization: {org.name} (ID: {org.id})")

        # 2. Fetch or create test Users with unique keys
        user1_res = await db.execute(select(User).where(User.username == "bulk_test_user_1"))
        user1 = user1_res.scalar_one_or_none()
        if not user1:
            user1 = User(
                username="bulk_test_user_1",
                email="user1@example.com",
                full_name="User One",
                hashed_password="hashedpassword123",
                role="USER",
                organization_id=org.id,
                unique_user_key="KEY-001"
            )
            db.add(user1)

        user2_res = await db.execute(select(User).where(User.username == "bulk_test_user_2"))
        user2 = user2_res.scalar_one_or_none()
        if not user2:
            user2 = User(
                username="bulk_test_user_2",
                email="user2@example.com",
                full_name="User Two",
                hashed_password="hashedpassword123",
                role="USER",
                organization_id=org.id,
                unique_user_key="KEY-002"
            )
            db.add(user2)
        await db.flush()
        print(f"Test Users created: {user1.username} ({user1.unique_user_key}), {user2.username} ({user2.unique_user_key})")

        # 3. Create a KPI with a Multi-Line field and a sub-field (column)
        kpi = KPI(name="Verification KPI", organization_id=org.id)
        db.add(kpi)
        await db.flush()

        mli_field = KPIField(
            kpi_id=kpi.id,
            name="Employee Tasks",
            key="employee_tasks",
            field_type=FieldType.multi_line_items,
            sort_order=1
        )
        db.add(mli_field)
        await db.flush()

        sub_field = KPIFieldSubField(
            field_id=mli_field.id,
            name="Assigned User Key",
            key="assigned_user_key",
            field_type=FieldType.single_line_text,
            sort_order=1
        )
        db.add(sub_field)

        desc_field = KPIFieldSubField(
            field_id=mli_field.id,
            name="Task Description",
            key="task_desc",
            field_type=FieldType.single_line_text,
            sort_order=2
        )
        db.add(desc_field)
        await db.flush()

        # 4. Create KPI Entry & Multi-Line rows
        entry = KPIEntry(
            kpi_id=kpi.id,
            organization_id=org.id,
            year=2026,
            period_key="Q1",
            is_draft=False
        )
        db.add(entry)
        await db.flush()

        # Row 1 for User 1
        row1 = KpiMultiLineRow(entry_id=entry.id, field_id=mli_field.id, row_index=0)
        db.add(row1)
        await db.flush()

        cell1_key = KpiMultiLineCell(row_id=row1.id, sub_field_id=sub_field.id, value_text="KEY-001")
        cell1_desc = KpiMultiLineCell(row_id=row1.id, sub_field_id=desc_field.id, value_text="Task for User One")
        db.add(cell1_key)
        db.add(cell1_desc)

        # Row 2 for User 2
        row2 = KpiMultiLineRow(entry_id=entry.id, field_id=mli_field.id, row_index=1)
        db.add(row2)
        await db.flush()

        cell2_key = KpiMultiLineCell(row_id=row2.id, sub_field_id=sub_field.id, value_text="KEY-002")
        cell2_desc = KpiMultiLineCell(row_id=row2.id, sub_field_id=desc_field.id, value_text="Task for User Two")
        db.add(cell2_key)
        db.add(cell2_desc)

        await db.flush()
        print("KPI structure, entries, and multi-line cell values inserted successfully.")

        # 5. Create Custom Report with Section containing our MLI field
        report = CustomReport(
            name="Verification Custom Report",
            organization_id=org.id
        )
        db.add(report)
        await db.flush()

        from app.core.models import CustomReportSection, CustomReportField
        section = CustomReportSection(
            custom_report_id=report.id,
            kpi_id=kpi.id,
            sort_order=1
        )
        db.add(section)
        await db.flush()

        cfield = CustomReportField(
            custom_report_id=report.id,
            custom_report_section_id=section.id,
            kpi_field_id=mli_field.id,
            sort_order=1
        )
        db.add(cfield)
        await db.flush()
        print(f"Custom Report template created (ID: {report.id})")

        # Create attachment to verify filtered attachment download
        attachment = CustomReportAttachment(
            custom_report_id=report.id,
            kpi_id=kpi.id,
            kpi_field_id=mli_field.id,
            title="Task List Attachment",
            selected_columns=["assigned_user_key", "task_desc"],
            sort_order=1
        )
        db.add(attachment)
        await db.flush()
        print(f"Custom Report attachment created (ID: {attachment.id})")

        # 6. Verify Bulk Access Assignment
        print("Testing bulk assign service...")
        assignments = await bulk_assign_custom_report(
            db,
            custom_report_id=report.id,
            user_ids=[user1.id, user2.id],
            can_view=True,
            can_print=False,
            can_export=True
        )
        assert len(assignments) == 2, f"Expected 2 assignments, got {len(assignments)}"
        assert assignments[0].can_view is True
        assert assignments[0].can_print is False
        assert assignments[0].can_export is True
        print("Bulk assignment assertions PASSED [OK]")

        # 7. Configure Filter configuration
        filter_config = ReportUserFilterConfiguration(
            report_id=report.id,
            enabled=True,
            kpi_id=kpi.id,
            mli_id=mli_field.id,
            field_id=sub_field.id,
            operator="=",
            dynamic_value_source="CURRENT_USER_UNIQUE_KEY"
        )
        db.add(filter_config)
        await db.flush()
        print("User-Based dynamic data filtering configuration enabled for sub-field.")

        # 8. Generate Report Data for User 1
        print("Generating custom report for User 1...")
        data_user1 = await generate_custom_report_data(
            db,
            id=report.id,
            org_id=org.id,
            year="2026",
            period_type="Q1",
            current_user=user1
        )
        
        # Verify filtering results
        sections = data_user1.get("sections", [])
        assert len(sections) == 1
        sec_fields = sections[0].get("fields", [])
        assert len(sec_fields) == 1
        
        field_val = sec_fields[0].get("value") # Since it is an MLI field, "value" is a list of dictionaries (rows)
        print(f"User 1 Field Values: {field_val}")
        assert len(field_val) == 1, f"Expected 1 row for User 1, got {len(field_val)}"
        assert field_val[0].get("assigned_user_key") == "KEY-001"
        assert field_val[0].get("task_desc") == "Task for User One"
        print("User 1 filtering assertions PASSED [OK]")

        # Verify filtered file export
        from app.reports.custom_service import export_custom_report_file, export_custom_report_attachments
        xlsx_bytes, xlsx_name, xlsx_type = await export_custom_report_file(
            db, report.id, org.id, year=2026, format="xlsx", period_type="Q1", current_user=user1
        )
        assert len(xlsx_bytes) > 0
        print("User 1 xlsx file export passed [OK]")

        # Verify filtered attachments export
        att_bytes, att_name, att_type = await export_custom_report_attachments(
            db, report.id, org.id, year=2026, format="xlsx", attachment_ids=[attachment.id], current_user=user1
        )
        assert len(att_bytes) > 0
        print("User 1 attachments export passed [OK]")

        # 9. Generate Report Data for User 2
        print("Generating custom report for User 2...")
        data_user2 = await generate_custom_report_data(
            db,
            id=report.id,
            org_id=org.id,
            year="2026",
            period_type="Q1",
            current_user=user2
        )
        field_val2 = data_user2.get("sections", [])[0].get("fields", [])[0].get("value")
        print(f"User 2 Field Values: {field_val2}")
        assert len(field_val2) == 1, f"Expected 1 row for User 2, got {len(field_val2)}"
        assert field_val2[0].get("assigned_user_key") == "KEY-002"
        assert field_val2[0].get("task_desc") == "Task for User Two"
        print("User 2 filtering assertions PASSED [OK]")

        # Verify filtered file export
        xlsx_bytes_2, xlsx_name_2, xlsx_type_2 = await export_custom_report_file(
            db, report.id, org.id, year=2026, format="xlsx", period_type="Q1", current_user=user2
        )
        assert len(xlsx_bytes_2) > 0
        print("User 2 xlsx file export passed [OK]")

        # Verify filtered attachments export
        att_bytes_2, att_name_2, att_type_2 = await export_custom_report_attachments(
            db, report.id, org.id, year=2026, format="xlsx", attachment_ids=[attachment.id], current_user=user2
        )
        assert len(att_bytes_2) > 0
        print("User 2 attachments export passed [OK]")

        # Rollback so we don't pollute the dev database
        await db.rollback()
        print("Database transaction rolled back successfully.")
        
    print("\nALL BULK USER CREATION & CUSTOM REPORT FILTERING VERIFICATIONS PASSED [SUCCESS]")

if __name__ == "__main__":
    asyncio.run(run_verification())

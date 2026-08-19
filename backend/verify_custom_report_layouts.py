import asyncio
import httpx
import html

BACKEND_URL = "http://127.0.0.1:8080/api"

async def test_layout_flow():
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. Fetch Captcha Challenge
        captcha_res = await client.get(f"{BACKEND_URL}/auth/captcha")
        if captcha_res.status_code != 200:
            print(f"[-] Fetch captcha challenge failed: {captcha_res.status_code}")
            return
        
        captcha_data = captcha_res.json()
        captcha_id = captcha_data["captcha_id"]
        
        # Resolve correct answer from DB
        from app.core.database import AsyncSessionLocal
        from sqlalchemy import select
        from app.core.models import CaptchaChallenge
        
        async with AsyncSessionLocal() as db_session:
            db_res = await db_session.execute(
                select(CaptchaChallenge).where(CaptchaChallenge.id == captcha_id)
            )
            challenge = db_res.scalar_one_or_none()
            if not challenge:
                print("[-] Captcha challenge not found in DB.")
                return
            captcha_answer = challenge.answer
            
        # 2. Login as Super Admin
        login_res = await client.post(
            f"{BACKEND_URL}/auth/login",
            json={
                "username": "UstadexAdmin",
                "password": "ustadex9876",
                "captcha_id": captcha_id,
                "captcha_answer": captcha_answer
            }
        )
        if login_res.status_code != 200:
            print(f"[-] Login failed: {login_res.status_code} - {login_res.text}")
            return
        
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("[+] Logged in as Super Admin successfully.")
        # 3. Resolve organization with a KPI and fields
        from app.core.database import AsyncSessionLocal
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        from app.core.models import KPI, KPIField
        
        org_id = None
        target_kpi_id = None
        target_field_id = None
        
        async with AsyncSessionLocal() as db_session:
            kpis_db = (await db_session.execute(
                select(KPI).options(selectinload(KPI.fields))
            )).scalars().all()
            for k in kpis_db:
                if k.fields:
                    org_id = k.organization_id
                    target_kpi_id = k.id
                    target_field_id = k.fields[0].id
                    break
        
        if not org_id:
            orgs_res = await client.get(f"{BACKEND_URL}/organizations", headers=headers)
            orgs = orgs_res.json()
            org_id = orgs[0]["id"]
            sections_payload = []
        else:
            sections_payload = [
                {
                    "kpi_id": target_kpi_id,
                    "custom_header": "Test Section 1",
                    "sort_order": 0,
                    "fields": [
                        {
                            "kpi_field_id": target_field_id,
                            "sort_order": 0,
                            "config": None
                        }
                    ]
                }
            ]

        print(f"[+] Picked organization ID: {org_id}")

        # 4. Create custom report header for testing layout
        print("[*] Creating custom header for report layout...")
        logo_data = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
        files = {"file": ("layout_test_logo.png", logo_data, "image/png")}
        header_form_data = {
            "name": "Layout Verification Header",
            "main_heading": "DEPARTMENT OF VERIFICATION (LAYOUTS)",
            "sub_heading": "Test Subheading",
            "font_family": "Arial",
            "font_size": "20",
            "text_color": "#123456",
            "organization_id": str(org_id)
        }
        
        hdr_res = await client.post(
            f"{BACKEND_URL}/reports/headers",
            headers=headers,
            data=header_form_data,
            files=files
        )
        if hdr_res.status_code != 201:
            print(f"[-] Failed to create custom report header: {hdr_res.text}")
            return
        
        header_id = hdr_res.json()["id"]
        print(f"[+] Created test header ID: {header_id}")

        # 5. Fetch custom reports list, or create one
        reps_res = await client.get(f"{BACKEND_URL}/custom-reports?organization_id={org_id}", headers=headers)
        if reps_res.status_code != 200:
            print(f"[-] Fetch custom reports failed: {reps_res.text}")
            return
        
        reports = reps_res.json()
        if not reports:
            print("[*] Creating a new custom report...")
            new_rep_res = await client.post(
                f"{BACKEND_URL}/custom-reports?organization_id={org_id}",
                headers=headers,
                json={
                    "name": "Layout Verification Report",
                    "description": "Validation testing layout configurations"
                }
            )
            if new_rep_res.status_code != 201:
                print(f"[-] Failed to create custom report: {new_rep_res.text}")
                return
            report_id = new_rep_res.json()["id"]
        else:
            report_id = reports[0]["id"]
        print(f"[+] Using custom report ID: {report_id}")

        # 6. Save layout with custom headers and branding settings
        print("[*] Saving layout with styling/branding fields...")
        layout_save_res = await client.put(
            f"{BACKEND_URL}/custom-reports/{report_id}/layout?organization_id={org_id}",
            headers=headers,
            json={
                "sections": sections_payload,
                "attachments": [],
                "fetch_data_with_date": False,
                "date_fetching_config": {},
                "report_header_id": header_id,
                "show_report_name": True,
                "branding_title": "QA VERIFICATION FOOTER BRANDING"
            }
        )
        if layout_save_res.status_code not in (200, 204):
            print(f"[-] Save layout failed ({layout_save_res.status_code}): {layout_save_res.text}")
            return
        print("[+] Layout saved successfully.")

        # 7. Verify fields in report detail endpoint
        print("[*] Retrieving custom report detail...")
        detail_res = await client.get(
            f"{BACKEND_URL}/custom-reports/{report_id}/detail?organization_id={org_id}",
            headers=headers
        )
        if detail_res.status_code != 200:
            print(f"[-] Get custom report detail failed: {detail_res.text}")
            return
        
        detail_data = detail_res.json()
        assert detail_data.get("report_header_id") == header_id, f"report_header_id mismatch: {detail_data.get('report_header_id')}"
        assert detail_data.get("show_report_name") is True, f"show_report_name mismatch: {detail_data.get('show_report_name')}"
        assert detail_data.get("branding_title") == "QA VERIFICATION FOOTER BRANDING", f"branding_title mismatch: {detail_data.get('branding_title')}"
        print("[+] Verified CustomReport detail returns new fields successfully.")

        # 8. Generate HTML report preview
        print("[*] Generating report data and preview...")
        gen_res = await client.get(
            f"{BACKEND_URL}/custom-reports/{report_id}/generate?year=2026&organization_id={org_id}&preview=true",
            headers=headers
        )
        if gen_res.status_code != 200:
            print(f"[-] Generate report preview failed: {gen_res.text}")
            return
        
        gen_data = gen_res.json()
        print(f"[*] GEN DATA IS: {gen_data}")
        rendered_html = gen_data.get("rendered_html", "")
        try:
            assert "DEPARTMENT OF VERIFICATION (LAYOUTS)" in rendered_html, "Header main heading not found in HTML"
            assert "Test Subheading" in rendered_html, "Header subheading not found in HTML"
            assert "Layout Verification Report" in rendered_html or "Verification Custom Report" in rendered_html, "Report name not found in HTML"
        except AssertionError as ae:
            print(f"[-] Assertion failed: {ae}")
            print(f"[*] RENDERED HTML IS:\n{rendered_html}")
            return
        print("[+] HTML custom report header rendering verified successfully!")

        # 9. Verify Exports
        # A. Excel (XLSX) format
        print("[*] Exporting custom report as XLSX...")
        exp_xlsx_res = await client.get(
            f"{BACKEND_URL}/custom-reports/{report_id}/export?year=2026&organization_id={org_id}&format=xlsx",
            headers=headers
        )
        if exp_xlsx_res.status_code != 200:
            print(f"[-] Export XLSX failed: {exp_xlsx_res.text}")
            return
        print(f"[+] Export XLSX successful (Length: {len(exp_xlsx_res.content)}).")

        # B. PDF format
        print("[*] Exporting custom report as PDF...")
        exp_pdf_res = await client.get(
            f"{BACKEND_URL}/custom-reports/{report_id}/export?year=2026&organization_id={org_id}&format=pdf",
            headers=headers
        )
        if exp_pdf_res.status_code != 200:
            print(f"[-] Export PDF failed: {exp_pdf_res.text}")
            return
        print(f"[+] Export PDF successful (Length: {len(exp_pdf_res.content)}).")

        # C. DOCX format
        print("[*] Exporting custom report as DOCX...")
        exp_docx_res = await client.get(
            f"{BACKEND_URL}/custom-reports/{report_id}/export?year=2026&organization_id={org_id}&format=docx",
            headers=headers
        )
        if exp_docx_res.status_code != 200:
            print(f"[-] Export DOCX failed: {exp_docx_res.text}")
            return
        print(f"[+] Export DOCX successful (Length: {len(exp_docx_res.content)}).")

        # 10. Cleanup header
        print("[*] Deleting custom report header...")
        del_hdr_res = await client.delete(
            f"{BACKEND_URL}/reports/headers/{header_id}",
            headers=headers
        )
        if del_hdr_res.status_code != 204:
            print(f"[-] Delete custom report header cleanup failed: {del_hdr_res.status_code}")
            return
        print("[+] Test cleanup completed successfully.")
        print("\n[***] CUSTOM REPORT LAYOUT INTEGRATION TESTS PASSED SUCCESSFULLY! [***]")

if __name__ == "__main__":
    asyncio.run(test_layout_flow())

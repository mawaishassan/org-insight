import asyncio
import httpx

BACKEND_URL = "http://127.0.0.1:8080/api"

async def test_flow():
    async with httpx.AsyncClient() as client:
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

        # 2. Get organization ID (Super Admin has no default org, let's list orgs and pick first one)
        orgs_res = await client.get(f"{BACKEND_URL}/organizations", headers=headers)
        if orgs_res.status_code != 200:
            print(f"[-] Fetch organizations failed: {orgs_res.status_code} - {orgs_res.text}")
            return
        
        orgs = orgs_res.json()
        if not orgs:
            print("[-] No organizations found in DB. Cannot test custom headers.")
            return
        
        org_id = orgs[0]["id"]
        print(f"[+] Picked organization: {orgs[0]['name']} (ID: {org_id})")

        # 3. Create Custom Report Header
        print("[*] Creating custom header...")
        logo_data = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;" # tiny valid GIF byte array
        files = {"file": ("test_logo.png", logo_data, "image/png")}
        data = {
            "name": "Integration Test Header",
            "main_heading": "DEPARTMENT OF VERIFICATION",
            "sub_heading": "Quality assurance and testing division",
            "font_family": "Courier",
            "font_size": "24",
            "text_color": "#ff0000",
            "organization_id": str(org_id)
        }
        
        create_res = await client.post(
            f"{BACKEND_URL}/reports/headers",
            headers=headers,
            data=data,
            files=files
        )
        if create_res.status_code != 201:
            print(f"[-] Create header failed: {create_res.status_code} - {create_res.text}")
            return
        
        header_data = create_res.json()
        header_id = header_data["id"]
        if header_data.get("font_family") != "Courier" or header_data.get("font_size") != 24 or header_data.get("text_color") != "#ff0000":
            print(f"[-] Created header styling fields mismatch: {header_data}")
            return
        print(f"[+] Created header successfully (ID: {header_id}).")

        # 4. List Custom Report Headers
        list_res = await client.get(
            f"{BACKEND_URL}/reports/headers?organization_id={org_id}",
            headers=headers
        )
        if list_res.status_code != 200:
            print(f"[-] List headers failed: {list_res.status_code}")
            return
        
        headers_list = list_res.json()
        if not any(h["id"] == header_id for h in headers_list):
            print("[-] Created header not found in list.")
            return
        print(f"[+] Verified list custom headers (Count: {len(headers_list)}).")

        # 5. Get Custom Report Header details
        get_res = await client.get(
            f"{BACKEND_URL}/reports/headers/{header_id}",
            headers=headers
        )
        if get_res.status_code != 200 or get_res.json()["name"] != "Integration Test Header":
            print(f"[-] Fetch header details failed: {get_res.status_code}")
            return
        print("[+] Verified header details retrieval.")

        # 6. Download Logo using query parameter token (FastAPI GET /logo)
        download_res = await client.get(
            f"{BACKEND_URL}/reports/headers/{header_id}/logo?token={token}"
        )
        if download_res.status_code != 200:
            print(f"[-] Download logo failed: {download_res.status_code} - {download_res.text}")
            return
        print(f"[+] Verified logo download via query param authentication (Bytes: {len(download_res.content)}).")

        # 7. Update Custom Report Header
        print("[*] Updating custom header details...")
        update_data = {
            "name": "Integration Test Header Updated",
            "main_heading": "DEPARTMENT OF VERIFICATION (QA)",
            "sub_heading": "Quality assurance division only",
            "font_family": "Times-Roman",
            "font_size": "18",
            "text_color": "#00ff00"
        }
        # Optionally upload new logo
        new_files = {"file": ("new_logo.png", logo_data, "image/png")}
        update_res = await client.put(
            f"{BACKEND_URL}/reports/headers/{header_id}",
            headers=headers,
            data=update_data,
            files=new_files
        )
        if update_res.status_code != 200 or update_res.json()["name"] != "Integration Test Header Updated":
            print(f"[-] Update header failed: {update_res.status_code} - {update_res.text}")
            return
        
        updated_data = update_res.json()
        if updated_data.get("font_family") != "Times-Roman" or updated_data.get("font_size") != 18 or updated_data.get("text_color") != "#00ff00":
            print(f"[-] Updated header styling fields mismatch: {updated_data}")
            return
        print("[+] Verified header details update.")

        # 8. Delete Custom Report Header
        delete_res = await client.delete(
            f"{BACKEND_URL}/reports/headers/{header_id}",
            headers=headers
        )
        if delete_res.status_code != 204:
            print(f"[-] Delete header failed: {delete_res.status_code}")
            return
        print("[+] Verified header deletion successfully.")

        # 9. Verify deletion list
        list_after_res = await client.get(
            f"{BACKEND_URL}/reports/headers?organization_id={org_id}",
            headers=headers
        )
        if any(h["id"] == header_id for h in list_after_res.json()):
            print("[-] Header still present after deletion.")
            return
        print("[+] Confirmed cleanup completed successfully.")
        print("\n[***] ALL INTEGRATION TESTS PASSED SUCCESSFULLY! [***]")

if __name__ == "__main__":
    asyncio.run(test_flow())

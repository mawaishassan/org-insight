import asyncio
import httpx
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from app.core.models import CustomReportHeader, CaptchaChallenge

BACKEND_URL = "http://127.0.0.1:8080/api"

async def main():
    async with httpx.AsyncClient() as client:
        # Get captcha
        captcha_res = await client.get(f"{BACKEND_URL}/auth/captcha")
        captcha_data = captcha_res.json()
        captcha_id = captcha_data["captcha_id"]
        
        async with AsyncSessionLocal() as db_session:
            db_res = await db_session.execute(
                select(CaptchaChallenge).where(CaptchaChallenge.id == captcha_id)
            )
            challenge = db_res.scalar_one_or_none()
            captcha_answer = challenge.answer

        # Login
        login_res = await client.post(
            f"{BACKEND_URL}/auth/login",
            json={
                "username": "UstadexAdmin",
                "password": "ustadex9876",
                "captcha_id": captcha_id,
                "captcha_answer": captcha_answer
            }
        )
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        # PUT update to Times-Roman
        put_res = await client.put(
            f"{BACKEND_URL}/reports/headers/2",
            headers=headers,
            data={
                "name": "UET Header",
                "main_heading": "University of Engineering & Technology, Lahore",
                "sub_heading": "Quality Enhancement Cell",
                "font_family": "Times-Roman",
                "font_size": "18",
                "text_color": "#1e3a8a"
            }
        )
        print("PUT Response status:", put_res.status_code)
        print("PUT Response body:", put_res.json())
        
        # Verify in DB
        async with AsyncSessionLocal() as db_session:
            db_res = await db_session.execute(
                select(CustomReportHeader).where(CustomReportHeader.id == 2)
            )
            h = db_res.scalar_one_or_none()
            print("DB Values now:")
            print("  Font Family:", h.font_family)
            print("  Font Size:", h.font_size)
            print("  Text Color:", h.text_color)

if __name__ == "__main__":
    asyncio.run(main())

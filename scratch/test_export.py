import asyncio
import httpx

BASE_URL = "http://localhost:8080/api"

async def main():
    async with httpx.AsyncClient() as client:
        # 1. Login as Org Admin
        r = await client.post(f"{BASE_URL}/auth/login", json={"username": "uet_admin", "password": "admin1234"})
        if r.status_code != 200:
            print("Login failed:", r.text)
            return
        token = r.json()["access_token"]
        print("Logged in successfully. Token length:", len(token))

        # 2. Try exporting without token parameter in query (expecting 401)
        r = await client.get(
            f"{BASE_URL}/custom-reports/1/export?year=2026&format=pdf&organization_id=3"
        )
        print("Export without token status:", r.status_code)
        print("Export without token response:", r.text[:200])

        # 3. Try exporting WITH token parameter in query
        r = await client.get(
            f"{BASE_URL}/custom-reports/1/export?year=2026&format=pdf&organization_id=3&token={token}"
        )
        print("Export with token status:", r.status_code)
        print("Export with token response headers:", dict(r.headers))
        if r.status_code != 200:
            print("Export failed content:", r.text)

if __name__ == "__main__":
    asyncio.run(main())

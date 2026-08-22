import asyncio
import httpx
import traceback

async def main():
    token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3ODc0NDg4MTgsInN1YiI6IjciLCJ0eXBlIjoiYWNjZXNzIiwicm9sZSI6Ik9SR19BRE1JTiIsIm9yZ2FuaXphdGlvbl9pZCI6M30.DxQ6Gqpou8WLbUqrktbIfJQ0zIgpOAmJIerWnlkj6Kk"
    
    payload = {
        "version": 1,
        "organization_id": 3,
        "dashboard_id": 12,
        "items": [
            {
                "widget": {
                    "id": "w_2slug8ak_ms30blsh",
                    "type": "kpi_card_single_value",
                    "title": "Total Research Grants",
                    "kpi_id": 219,
                    "year": 2026,
                    "period_key": None,
                    "source_mode": "field",
                    "field_key": "total_research_grants",
                    "decimals": 0,
                    "thousand_sep": True,
                    "align": "left",
                    "theme": "success_light",
                    "allow_custom_colors": False,
                    "filters": None,
                    "full_width": False,
                    "col_span": 6
                },
                "overrides": {}
            }
        ]
    }
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            print("Sending request to /api/widget-data/dashboard/batch...")
            response = await client.post(
                "http://localhost:8080/api/widget-data/dashboard/batch",
                json=payload,
                headers=headers
            )
            print(f"Status: {response.status_code}")
            print("Response:", response.text)
        except Exception as e:
            print("Error details:")
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())

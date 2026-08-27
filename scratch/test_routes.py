import asyncio
import os
import sys
import httpx

# We will run a quick request against the local running backend server (if running) or call list_multi_items_rows directly via FastAPI TestClient!
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from fastapi.testclient import TestClient
from app.main import app

def main():
    client = TestClient(app)
    
    # We need a user token. Let's authenticate or bypass by mocking get_current_user.
    # Actually, we can just mock Depends(get_current_user) and Depends(require_org_admin) to bypass authentication for local script verification!
    from app.core.dependencies import get_current_user, require_org_admin
    from app.core.models import User, OrganizationRole
    
    dummy_user = User(
        id=1,
        organization_id=3,
        role=OrganizationRole.SUPER_ADMIN,
    )
    
    app.dependency_overrides[get_current_user] = lambda: dummy_user
    app.dependency_overrides[require_org_admin] = lambda: dummy_user
    
    try:
        print("\n--- SENDING GET /entries/multi-items/rows ---")
        res = client.get(
            "/entries/multi-items/rows",
            params={
                "entry_id": 386,
                "field_id": 642,
                "organization_id": 3,
                "page": 1,
                "page_size": 20
            }
        )
        print("Status code:", res.status_code)
        if res.status_code == 200:
            data = res.json()
            print("Total rows:", data.get("total"))
            print("First row:", data.get("rows")[0] if data.get("rows") else None)
        else:
            print("Error response:", res.text)
    finally:
        app.dependency_overrides.clear()

if __name__ == "__main__":
    main()

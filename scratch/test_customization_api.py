import asyncio
import httpx

BASE_URL = "http://localhost:8080/api"

async def main():
    async with httpx.AsyncClient() as client:
        # 1. Login as Super Admin
        r = await client.post(f"{BASE_URL}/auth/login", json={"username": "UstadexAdmin", "password": "admin1234"})
        assert r.status_code == 200, f"Super Admin login failed: {r.text}"
        super_token = r.json()["access_token"]
        print("Logged in as Super Admin successfully")

        # 2. Login as Org Admin
        r = await client.post(f"{BASE_URL}/auth/login", json={"username": "uet_admin", "password": "admin1234"})
        assert r.status_code == 200, f"Org Admin login failed: {r.text}"
        org_token = r.json()["access_token"]
        print("Logged in as Org Admin successfully")

        # 3. Fetch customizations (should be empty or list)
        r = await client.get(
            f"{BASE_URL}/dashboards/12/label-customizations",
            headers={"Authorization": f"Bearer {org_token}"}
        )
        assert r.status_code == 200, f"Org admin failed to fetch customizations: {r.text}"
        print("Fetched initial customizations:", r.json())

        # 4. Try POST customization as Org Admin (should fail with 403)
        r = await client.post(
            f"{BASE_URL}/dashboards/12/label-customizations",
            headers={"Authorization": f"Bearer {org_token}"},
            json={
                "widget_id": "test_widget_1",
                "original_label": "University",
                "customized_label": "Uni"
            }
        )
        assert r.status_code == 403, f"Expected 403 for Org Admin, got {r.status_code}: {r.text}"
        print("POST Org Admin: Successfully blocked with 403")

        # 5. Try POST customization as Super Admin (should succeed)
        r = await client.post(
            f"{BASE_URL}/dashboards/12/label-customizations",
            headers={"Authorization": f"Bearer {super_token}"},
            json={
                "widget_id": "test_widget_1",
                "original_label": "University",
                "customized_label": "Uni"
            }
        )
        assert r.status_code == 200, f"Expected 200 for Super Admin, got {r.status_code}: {r.text}"
        created = r.json()
        print("POST Super Admin: Customization created successfully:", created)

        # 6. Fetch customizations again as Org Admin (should see created customization)
        r = await client.get(
            f"{BASE_URL}/dashboards/12/label-customizations",
            headers={"Authorization": f"Bearer {org_token}"}
        )
        assert r.status_code == 200, f"Failed to fetch customizations: {r.text}"
        customizations = r.json()
        assert len(customizations) > 0, "No customizations returned"
        assert customizations[0]["original_label"] == "University"
        assert customizations[0]["customized_label"] == "Uni"
        print("GET Org Admin: Successfully saw updated customizations")

        # 7. Try DELETE customization as Org Admin (should fail with 403)
        r = await client.delete(
            f"{BASE_URL}/dashboards/12/label-customizations?original_label=University&widget_id=test_widget_1",
            headers={"Authorization": f"Bearer {org_token}"}
        )
        assert r.status_code == 403, f"Expected 403 for Org Admin, got {r.status_code}: {r.text}"
        print("DELETE Org Admin: Successfully blocked with 403")

        # 8. Try DELETE customization as Super Admin (should succeed)
        r = await client.delete(
            f"{BASE_URL}/dashboards/12/label-customizations?original_label=University&widget_id=test_widget_1",
            headers={"Authorization": f"Bearer {super_token}"}
        )
        assert r.status_code == 204, f"Expected 204 for Super Admin, got {r.status_code}: {r.text}"
        print("DELETE Super Admin: Deleted customization successfully")

        # 9. Verify customizations are empty again
        r = await client.get(
            f"{BASE_URL}/dashboards/12/label-customizations",
            headers={"Authorization": f"Bearer {org_token}"}
        )
        assert r.status_code == 200, f"Failed to fetch customizations: {r.text}"
        assert not any(c["original_label"] == "University" and c["widget_id"] == "test_widget_1" for c in r.json()), "Customization still exists"
        print("Verification: Customization was successfully deleted")

        print("\nALL API INTEGRATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import DashboardAccessPermission, User, Dashboard
from app.dashboards.service import bulk_assign_dashboards_to_users, list_dashboard_assignments, get_dashboard_filterable_columns
from app.widget_data.service import _get_dashboard_user_filter_and_permissions

async def run_bulk_assignment_tests():
    async with AsyncSessionLocal() as db:
        print("=== 1. Testing DB schema columns on DashboardAccessPermission ===")
        res = await db.execute(select(DashboardAccessPermission).limit(1))
        perm = res.scalar_one_or_none()
        if perm:
            print(f"Found permission row. can_load_lms={getattr(perm, 'can_load_lms', None)}, can_change_period={getattr(perm, 'can_change_period', None)}, can_use_unique_value={getattr(perm, 'can_use_unique_value', None)}")

        print("\n=== 2. Testing Bulk Dashboard Assignment service ===")
        # Get existing dashboards and users
        d_res = await db.execute(select(Dashboard).limit(2))
        dashboards = list(d_res.scalars().all())
        u_res = await db.execute(select(User).where(User.role == "USER").limit(2))
        users = list(u_res.scalars().all())

        if dashboards and users:
            d_ids = [d.id for d in dashboards]
            u_ids = [u.id for u in users]
            org_id = dashboards[0].organization_id

            count = await bulk_assign_dashboards_to_users(
                db,
                org_id,
                d_ids,
                u_ids,
                can_view=True,
                can_edit=False,
                can_load_lms=False,
                can_change_period=False,
                can_use_unique_value=True,
                filter_sub_field_key="department",
            )
            await db.commit()
            print(f"Bulk assignment executed successfully. Updated {count} permission records.")

            print("\n=== 3. Testing listing dashboard assignments ===")
            assignments = await list_dashboard_assignments(db, d_ids[0], org_id)
            print(f"Retrieved {len(assignments)} assignments for dashboard {d_ids[0]}. Sample: {assignments[0] if assignments else None}")

            print("\n=== 4. Testing user-specific query-level filter resolution ===")
            user_filters, user_perms = await _get_dashboard_user_filter_and_permissions(db, users[0], d_ids[0])
            print(f"User filters for User {users[0].username}: {user_filters}")
            print(f"User permissions for User {users[0].username}: {user_perms}")

            print("\n=== 5. Testing dashboard filterable columns introspection ===")
            cols = await get_dashboard_filterable_columns(db, d_ids[0], org_id)
            print(f"Found {len(cols)} filterable MLI columns for dashboard {d_ids[0]}. Sample: {cols[0] if cols else None}")

        print("\nAll bulk assignment & permissions tests completed cleanly!")

if __name__ == "__main__":
    asyncio.run(run_bulk_assignment_tests())

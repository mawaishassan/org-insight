from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.models import CustomReportGroup
from app.reports.custom_report_groups.schemas import CustomReportGroupCreate, CustomReportGroupUpdate

async def get_custom_report_group(db: AsyncSession, group_id: int, org_id: int) -> CustomReportGroup | None:
    result = await db.execute(
        select(CustomReportGroup)
        .where(CustomReportGroup.id == group_id, CustomReportGroup.organization_id == org_id)
    )
    return result.scalar_one_or_none()

async def list_custom_report_groups(db: AsyncSession, org_id: int) -> list[CustomReportGroup]:
    result = await db.execute(
        select(CustomReportGroup)
        .where(CustomReportGroup.organization_id == org_id)
        .order_by(CustomReportGroup.sort_order, CustomReportGroup.name)
    )
    return list(result.scalars().all())

async def create_custom_report_group(db: AsyncSession, org_id: int, data: CustomReportGroupCreate) -> CustomReportGroup:
    group = CustomReportGroup(
        organization_id=org_id,
        name=data.name,
        sort_order=data.sort_order,
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group

async def update_custom_report_group(
    db: AsyncSession, group_id: int, org_id: int, data: CustomReportGroupUpdate
) -> CustomReportGroup | None:
    group = await get_custom_report_group(db, group_id, org_id)
    if not group:
        return None

    if data.name is not None:
        group.name = data.name
    if data.sort_order is not None:
        group.sort_order = data.sort_order

    await db.commit()
    await db.refresh(group)
    return group

async def delete_custom_report_group(db: AsyncSession, group_id: int, org_id: int) -> bool:
    group = await get_custom_report_group(db, group_id, org_id)
    if not group:
        return False

    await db.delete(group)
    await db.commit()
    return True

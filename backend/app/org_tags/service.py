"""Organization tag CRUD."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.core.models import OrganizationTag, Organization, KPIOrganizationTag
from app.org_tags.schemas import OrganizationTagCreate, OrganizationTagUpdate


async def list_org_tags(db: AsyncSession, org_id: int) -> list[OrganizationTag]:
    """List all tags for an organization."""
    result = await db.execute(
        select(OrganizationTag)
        .where(OrganizationTag.organization_id == org_id)
        .order_by(OrganizationTag.name)
    )
    return list(result.scalars().all())


async def get_org_tag(
    db: AsyncSession, org_id: int, tag_id: int
) -> OrganizationTag | None:
    """Get tag by id; must belong to org."""
    result = await db.execute(
        select(OrganizationTag).where(
            OrganizationTag.id == tag_id,
            OrganizationTag.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def create_org_tag(
    db: AsyncSession, org_id: int, data: OrganizationTagCreate
) -> OrganizationTag | None:
    """Create tag in organization (org must exist)."""
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    if not result.scalar_one_or_none():
        return None
    tag = OrganizationTag(organization_id=org_id, name=data.name.strip())
    db.add(tag)
    await db.flush()
    return tag


async def update_org_tag(
    db: AsyncSession, org_id: int, tag_id: int, data: OrganizationTagUpdate
) -> OrganizationTag | None:
    """Update tag."""
    tag = await get_org_tag(db, org_id, tag_id)
    if not tag:
        return None
    tag.name = data.name.strip()
    await db.flush()
    return tag


async def delete_org_tag(
    db: AsyncSession, org_id: int, tag_id: int
) -> bool:
    """Delete tag. Remove all KPI–tag links first so KPIs are no longer tagged with this tag."""
    tag = await get_org_tag(db, org_id, tag_id)
    if not tag:
        return False
    await db.execute(delete(KPIOrganizationTag).where(KPIOrganizationTag.organization_tag_id == tag_id))
    await db.flush()
    await db.delete(tag)
    await db.flush()
    return True

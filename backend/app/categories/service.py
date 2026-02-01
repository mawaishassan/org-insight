"""Category CRUD within a domain."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.models import Category, Domain
from app.categories.schemas import CategoryCreate, CategoryUpdate


async def _domain_org_id(db: AsyncSession, domain_id: int) -> int | None:
    """Return organization_id for domain or None."""
    result = await db.execute(select(Domain).where(Domain.id == domain_id))
    d = result.scalar_one_or_none()
    return d.organization_id if d else None


async def create_category(
    db: AsyncSession, domain_id: int, org_id: int, data: CategoryCreate
) -> Category | None:
    """Create category in domain (domain must belong to org)."""
    if await _domain_org_id(db, domain_id) != org_id:
        return None
    category = Category(
        domain_id=domain_id,
        name=data.name,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(category)
    await db.flush()
    return category


async def get_category(
    db: AsyncSession, category_id: int, domain_id: int, org_id: int
) -> Category | None:
    """Get category by id; domain must belong to org."""
    result = await db.execute(
        select(Category)
        .join(Category.domain)
        .where(
            Category.id == category_id,
            Category.domain_id == domain_id,
            Domain.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def list_categories(
    db: AsyncSession, domain_id: int, org_id: int
) -> list[Category]:
    """List categories in domain (domain must belong to org)."""
    if await _domain_org_id(db, domain_id) != org_id:
        return []
    result = await db.execute(
        select(Category)
        .where(Category.domain_id == domain_id)
        .order_by(Category.sort_order, Category.name)
        .options(selectinload(Category.kpi_categories))
    )
    return list(result.scalars().all())


async def list_categories_for_org(db: AsyncSession, org_id: int) -> list[Category]:
    """List all categories in organization (across all domains)."""
    result = await db.execute(
        select(Category)
        .join(Category.domain)
        .where(Domain.organization_id == org_id)
        .order_by(Category.sort_order, Category.name)
        .options(selectinload(Category.domain), selectinload(Category.kpi_categories))
    )
    return list(result.scalars().all())


async def update_category(
    db: AsyncSession, category_id: int, domain_id: int, org_id: int, data: CategoryUpdate
) -> Category | None:
    """Update category."""
    category = await get_category(db, category_id, domain_id, org_id)
    if not category:
        return None
    if data.name is not None:
        category.name = data.name
    if data.description is not None:
        category.description = data.description
    if data.sort_order is not None:
        category.sort_order = data.sort_order
    await db.flush()
    return category


async def delete_category(
    db: AsyncSession, category_id: int, domain_id: int, org_id: int
) -> bool:
    """Delete category."""
    category = await get_category(db, category_id, domain_id, org_id)
    if not category:
        return False
    await db.delete(category)
    await db.flush()
    return True

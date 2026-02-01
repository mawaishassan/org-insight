"""Category API routes (within a domain)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import require_org_admin
from app.core.models import User
from app.categories.schemas import CategoryCreate, CategoryUpdate, CategoryResponse
from app.categories.service import (
    create_category,
    get_category,
    list_categories,
    list_categories_for_org,
    update_category,
    delete_category,
)

router = APIRouter(prefix="/categories", tags=["categories"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


@router.get("", response_model=list[CategoryResponse])
async def list_domain_categories(
    domain_id: int | None = Query(None, description="Domain to list categories for"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List categories: by domain_id (required for single domain), or all in org when organization_id only (super admin)."""
    org_id = _org_id(current_user, organization_id)
    if domain_id is not None:
        categories = await list_categories(db, domain_id, org_id)
        return [
            CategoryResponse.model_validate(c).model_copy(update={"kpi_count": len(c.kpi_categories)})
            for c in categories
        ]
    # List all categories in org (for filters)
    categories = await list_categories_for_org(db, org_id)
    result = []
    for c in categories:
        r = CategoryResponse.model_validate(c).model_copy(update={"kpi_count": len(c.kpi_categories)})
        if c.domain:
            r.domain_name = c.domain.name
        result.append(r)
    return result


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_domain_category(
    body: CategoryCreate,
    domain_id: int = Query(..., description="Domain to add category to"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create category in domain."""
    org_id = _org_id(current_user, organization_id)
    category = await create_category(db, domain_id, org_id, body)
    if not category:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Domain not in organization")
    await db.commit()
    await db.refresh(category)
    return CategoryResponse.model_validate(category)


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_domain_category(
    category_id: int,
    domain_id: int = Query(..., description="Domain the category belongs to"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Get category by id."""
    org_id = _org_id(current_user, organization_id)
    category = await get_category(db, category_id, domain_id, org_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return CategoryResponse.model_validate(category)


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_domain_category(
    category_id: int,
    body: CategoryUpdate,
    domain_id: int = Query(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update category."""
    org_id = _org_id(current_user, organization_id)
    category = await update_category(db, category_id, domain_id, org_id, body)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await db.commit()
    await db.refresh(category)
    return CategoryResponse.model_validate(category)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_domain_category(
    category_id: int,
    domain_id: int = Query(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete category."""
    org_id = _org_id(current_user, organization_id)
    ok = await delete_category(db, category_id, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await db.commit()

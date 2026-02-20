"""Organization API routes (Super Admin and org-scoped export token)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.models import User, OrganizationStorageConfig
from app.auth.dependencies import require_super_admin, get_current_user, require_org_admin_for_org
from app.organizations.schemas import (
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationResponse,
    OrganizationWithSummary,
    OrganizationSummary,
    ExportTokenCreate,
    ExportTokenResponse,
    StorageConfigUpdate,
    StorageConfigResponse,
    STORAGE_TYPES,
    mask_storage_params,
)
from app.organizations.service import (
    create_organization,
    get_organization,
    list_organizations,
    get_organization_summary,
    update_organization,
    get_organization_filter_options,
    create_export_api_token,
)
from app.storage.service import get_config as get_storage_config

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("", response_model=list[OrganizationResponse] | list[OrganizationWithSummary])
async def list_orgs(
    with_summary: bool = False,
    name: str | None = Query(None, description="Search by organization name (partial match)"),
    is_active: bool | None = Query(None, description="Filter by active status"),
    domain_id: int | None = Query(None, description="Organizations that have this domain"),
    kpi_id: int | None = Query(None, description="Organizations that have this KPI"),
    category_id: int | None = Query(None, description="Organizations that have this category"),
    organization_tag_id: int | None = Query(None, description="Organizations that have this tag"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """List all organizations (Super Admin only). Optionally include summary counts and filters."""
    orgs = await list_organizations(
        db,
        name=name,
        is_active=is_active,
        domain_id=domain_id,
        kpi_id=kpi_id,
        category_id=category_id,
        organization_tag_id=organization_tag_id,
    )
    if not with_summary:
        return [OrganizationResponse.model_validate(o) for o in orgs]
    result = []
    for o in orgs:
        summary = await get_organization_summary(db, o.id)
        result.append(
            OrganizationWithSummary(
                id=o.id,
                name=o.name,
                description=o.description,
                is_active=o.is_active,
                summary=summary or _default_summary(),
            )
        )
    return result


@router.get("/filter-options")
async def list_org_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """List filter dropdown options for organizations (domains, kpis, categories, tags). Super Admin only."""
    return await get_organization_filter_options(db)


def _default_summary() -> OrganizationSummary:
    return OrganizationSummary(user_count=0, domain_count=0, kpi_count=0)


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_org(
    body: OrganizationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Create organization and admin user (Super Admin only)."""
    org = await create_organization(db, body)
    await db.commit()
    await db.refresh(org)
    return OrganizationResponse.model_validate(org)


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_org(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Get organization by id."""
    org = await get_organization(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return OrganizationResponse.model_validate(org)


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_org(
    org_id: int,
    body: OrganizationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Update organization (activate/deactivate)."""
    org = await update_organization(db, org_id, body)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    await db.commit()
    await db.refresh(org)
    return OrganizationResponse.model_validate(org)


@router.post("/{org_id}/export-token", response_model=ExportTokenResponse, status_code=status.HTTP_201_CREATED)
async def create_org_export_token(
    org_id: int,
    body: ExportTokenCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin_for_org),
):
    """Generate a long-lived export API token for this organization. Org Admin (for their org) or Super Admin. Token is shown once; valid for the given hours."""
    org = await get_organization(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    token, expires_at = await create_export_api_token(
        db, organization_id=org_id, valid_hours=body.valid_hours, created_by_user_id=current_user.id
    )
    await db.commit()
    return ExportTokenResponse(
        token=token,
        expires_at=expires_at.isoformat() + "Z",
    )


def _validate_storage_params(storage_type: str, params: dict | None) -> None:
    """Validate type-specific params. Raises ValueError with a clear message."""
    if storage_type not in STORAGE_TYPES:
        raise ValueError(f"storage_type must be one of: {', '.join(STORAGE_TYPES)}")
    params = params or {}
    if storage_type == "local":
        # base_path optional; default from settings
        pass
    elif storage_type == "gcs":
        if not params.get("bucket_name") and not params.get("bucket"):
            raise ValueError("GCS requires bucket_name or bucket")
    elif storage_type == "ftp":
        if not params.get("host"):
            raise ValueError("FTP requires host")
    elif storage_type == "s3":
        if not params.get("bucket"):
            raise ValueError("S3 requires bucket")
    elif storage_type == "onedrive":
        # OAuth/app config varies
        pass


@router.get("/{org_id}/storage-config", response_model=StorageConfigResponse)
async def get_org_storage_config(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Get organization storage config (Super Admin only). Secrets are masked in response."""
    org = await get_organization(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    config = await get_storage_config(db, org_id)
    if not config:
        return StorageConfigResponse(
            organization_id=org_id,
            storage_type="local",
            params=mask_storage_params({}),
            created_at=None,
            updated_at=None,
        )
    return StorageConfigResponse(
        organization_id=config.organization_id,
        storage_type=config.storage_type,
        params=mask_storage_params(config.params),
        created_at=config.created_at.isoformat() + "Z" if config.created_at else None,
        updated_at=config.updated_at.isoformat() + "Z" if config.updated_at else None,
    )


@router.patch("/{org_id}/storage-config", response_model=StorageConfigResponse)
async def update_org_storage_config(
    org_id: int,
    body: StorageConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Create or update organization storage config (Super Admin only). Params are type-specific; secrets are stored securely and masked in responses."""
    org = await get_organization(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    try:
        _validate_storage_params(body.storage_type, body.params)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    config = await get_storage_config(db, org_id)
    incoming = body.params or {}
    # Merge with existing so masked/unchanged values ("***") are not written over real secrets
    if config and config.params:
        params = dict(config.params)
        for k, v in incoming.items():
            if v != "***":
                params[k] = v
    else:
        params = {k: v for k, v in incoming.items() if v != "***"}
    if config:
        config.storage_type = body.storage_type
        config.params = params
        await db.flush()
        await db.refresh(config)
    else:
        config = OrganizationStorageConfig(
            organization_id=org_id,
            storage_type=body.storage_type,
            params=params,
        )
        db.add(config)
        await db.flush()
        await db.refresh(config)
    await db.commit()
    return StorageConfigResponse(
        organization_id=config.organization_id,
        storage_type=config.storage_type,
        params=mask_storage_params(config.params),
        created_at=config.created_at.isoformat() + "Z" if config.created_at else None,
        updated_at=config.updated_at.isoformat() + "Z" if config.updated_at else None,
    )

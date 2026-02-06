"""KPI API routes (Org Admin)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import require_org_admin
from app.core.models import User
from app.kpis.schemas import (
    KPICreate,
    KPIUpdate,
    KPIResponse,
    KPIChildDataSummary,
    KPIApiContract,
    KPIApiContractField,
    KPIAssignUserBody,
    DomainTagRef,
    CategoryTagRef,
    OrganizationTagRef,
    AssignedUserRef,
)
from app.kpis.service import (
    create_kpi,
    get_kpi,
    get_kpi_with_tags,
    get_kpi_with_tags_by_id,
    list_kpis,
    list_kpis_for_formula_refs,
    update_kpi,
    delete_kpi,
    get_kpi_child_data_summary,
    add_kpi_domain,
    remove_kpi_domain,
    add_kpi_category,
    remove_kpi_category,
    list_kpi_assignments,
    assign_user_to_kpi,
    unassign_user_from_kpi,
    sync_kpi_entry_from_api,
)
from app.users.schemas import UserResponse
from app.fields.service import list_fields as list_kpi_fields
from app.core.models import FieldType

router = APIRouter(prefix="/kpis", tags=["kpis"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


def _kpi_to_response(k):
    """Build KPIResponse. Domain tags come only from categories (single source: attach KPI to category)."""
    category_tags = []
    domain_tags = []
    seen_domain_ids = set()
    for kc in getattr(k, "category_tags", []) or []:
        if kc.category:
            cat = kc.category
            domain_id = getattr(cat, "domain_id", None) or (cat.domain.id if getattr(cat, "domain", None) else None)
            domain_name = (cat.domain.name if getattr(cat, "domain", None) else None)
            category_tags.append(
                CategoryTagRef(id=cat.id, name=cat.name, domain_id=domain_id, domain_name=domain_name)
            )
            if domain_id is not None and domain_id not in seen_domain_ids:
                seen_domain_ids.add(domain_id)
                domain_tags.append(DomainTagRef(id=domain_id, name=domain_name or f"Domain {domain_id}"))
    organization_tags = []
    for kot in getattr(k, "organization_tags", []) or []:
        if getattr(kot, "tag", None):
            organization_tags.append(OrganizationTagRef(id=kot.tag.id, name=kot.tag.name))
    assigned_users = []
    for ka in getattr(k, "assignments", []) or []:
        if getattr(ka, "user", None):
            u = ka.user
            assigned_users.append(AssignedUserRef(id=u.id, username=u.username, full_name=u.full_name))
    return KPIResponse(
        id=k.id,
        organization_id=k.organization_id,
        domain_id=k.domain_id,
        name=k.name,
        description=k.description,
        year=k.year,
        sort_order=k.sort_order,
        entry_mode=getattr(k, "entry_mode", None) or "manual",
        api_endpoint_url=getattr(k, "api_endpoint_url", None),
        card_display_field_ids=getattr(k, "card_display_field_ids", None) or None,
        domain_tags=domain_tags,
        category_tags=category_tags,
        organization_tags=organization_tags,
        assigned_users=assigned_users,
    )


@router.get("/formula-refs")
async def list_kpis_for_formula_refs_api(
    organization_id: int | None = Query(None),
    exclude_kpi_id: int | None = Query(None, description="Exclude this KPI (e.g. current KPI when building formula)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List KPIs in organization with numeric fields only, for KPI_FIELD(kpi_id, field_key) formula references."""
    org_id = _org_id(current_user, organization_id)
    items = await list_kpis_for_formula_refs(db, org_id, exclude_kpi_id=exclude_kpi_id)
    return items


@router.get("", response_model=list[KPIResponse])
async def list_org_kpis(
    organization_id: int | None = Query(None),
    domain_id: int | None = Query(None),
    category_id: int | None = Query(None),
    organization_tag_id: int | None = Query(None, description="Filter KPIs by organization tag"),
    year: int | None = Query(None),
    name: str | None = Query(None, description="Filter KPIs by name (partial match)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List KPIs in organization. Filter by domain_id, category_id, organization_tag_id, year, or name."""
    org_id = _org_id(current_user, organization_id)
    kpis = await list_kpis(
        db, org_id, domain_id=domain_id, category_id=category_id, organization_tag_id=organization_tag_id, year=year, name=name
    )
    return [_kpi_to_response(k) for k in kpis]


@router.post("", response_model=KPIResponse, status_code=status.HTTP_201_CREATED)
async def create_org_kpi(
    body: KPICreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create KPI in domain."""
    org_id = _org_id(current_user, organization_id)
    kpi = await create_kpi(db, org_id, body)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Domain not in organization")
    await db.commit()
    k = await get_kpi_with_tags(db, kpi.id, org_id)
    return _kpi_to_response(k)


@router.get("/{kpi_id}", response_model=KPIResponse)
async def get_org_kpi(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Get KPI by id with domain and category tags. Super admin without organization_id gets KPI by id (org resolved from KPI)."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        kpi = await get_kpi_with_tags_by_id(db, kpi_id)
    else:
        org_id = _org_id(current_user, organization_id)
        kpi = await get_kpi_with_tags(db, kpi_id, org_id)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return _kpi_to_response(kpi)


@router.patch("/{kpi_id}", response_model=KPIResponse)
async def update_org_kpi(
    kpi_id: int,
    body: KPIUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update KPI."""
    # Only SUPER_ADMIN may control which fields show on domain KPI cards
    if body.card_display_field_ids is not None and current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin may set KPI card display fields",
        )
    org_id = _org_id(current_user, organization_id)
    kpi = await update_kpi(db, kpi_id, org_id, body)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    await db.commit()
    k = await get_kpi_with_tags(db, kpi_id, org_id)
    return _kpi_to_response(k)


@router.get("/{kpi_id}/child_data_summary", response_model=KPIChildDataSummary)
async def get_kpi_child_data(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return counts of child records (assignments, entries, fields, etc.) for delete confirmation."""
    org_id = _org_id(current_user, organization_id)
    summary = await get_kpi_child_data_summary(db, kpi_id, org_id)
    if summary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return KPIChildDataSummary(**summary)


@router.delete("/{kpi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_kpi(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete KPI and all child records (assignments, entries, fields, stored values, report refs)."""
    org_id = _org_id(current_user, organization_id)
    ok = await delete_kpi(db, kpi_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    await db.commit()


@router.post("/{kpi_id}/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_domain_tag(
    kpi_id: int,
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Associate KPI with an additional domain (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await add_kpi_domain(db, kpi_id, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or domain not found")
    await db.commit()


@router.delete("/{kpi_id}/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_domain_tag(
    kpi_id: int,
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove KPI-domain association (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await remove_kpi_domain(db, kpi_id, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cannot remove or not found")
    await db.commit()


@router.post("/{kpi_id}/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_category_tag(
    kpi_id: int,
    category_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Associate KPI with a category (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await add_kpi_category(db, kpi_id, category_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or category not found")
    await db.commit()


@router.delete("/{kpi_id}/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_category_tag(
    kpi_id: int,
    category_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove KPI-category association (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await remove_kpi_category(db, kpi_id, category_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.get("/{kpi_id}/assignments", response_model=list[UserResponse])
async def list_kpi_assignments_route(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List users assigned to this KPI (can add data)."""
    org_id = _org_id(current_user, organization_id)
    users = await list_kpi_assignments(db, kpi_id, org_id)
    return [UserResponse.model_validate(u) for u in users]


@router.post("/{kpi_id}/assignments", status_code=status.HTTP_201_CREATED)
async def assign_user_to_kpi_route(
    kpi_id: int,
    body: KPIAssignUserBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign a user to this KPI so they can add data."""
    org_id = _org_id(current_user, organization_id)
    ok = await assign_user_to_kpi(db, kpi_id, body.user_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or user not found")
    await db.commit()


@router.delete("/{kpi_id}/assignments/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_from_kpi_route(
    kpi_id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove user assignment from this KPI."""
    org_id = _org_id(current_user, organization_id)
    ok = await unassign_user_from_kpi(db, kpi_id, user_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


def _field_type_str(f) -> str:
    """Normalize field type to lowercase string for consistent comparison."""
    ft = getattr(f, "field_type", None)
    if hasattr(ft, "value"):
        ft = ft.value if ft else "single_line_text"
    else:
        ft = str(ft) if ft else "single_line_text"
    return (ft or "single_line_text").lower()


def _example_value_for_field(f) -> str | int | float | bool | list[dict] | None:
    """Return a concrete example value for API contract by field type. f is KPIField."""
    ft = _field_type_str(f)
    if ft == "formula":
        return None
    if ft == "number":
        return 100
    if ft == "boolean":
        return 1  # API may send 1 or 0
    if ft == "date":
        return "2025-01-15"
    if ft == "multi_line_items":
        sub_fields = getattr(f, "sub_fields", None) or []
        sub_keys = [getattr(s, "key", f"col_{i}") for i, s in enumerate(sub_fields)]
        if not sub_keys:
            sub_keys = ["item_name", "quantity"]
        # Example: list of row objects; each row has all sub_keys with sample values
        numeric_types = {"number"}
        sub_types = {}
        for s in sub_fields:
            st = getattr(getattr(s, "field_type", None), "value", None) or str(getattr(s, "field_type", "single_line_text"))
            sub_types[getattr(s, "key", "")] = st in numeric_types
        rows = []
        for row_idx in range(2):
            row = {}
            for k in sub_keys:
                if sub_types.get(k, False):
                    row[k] = 85 + row_idx * 5
                else:
                    row[k] = ("Alice", "Bob")[row_idx]
            rows.append(row)
        return rows
    # single_line_text, multi_line_text
    return "Example text" if ft == "single_line_text" else "First paragraph.\n\nSecond paragraph."


@router.get("/{kpi_id}/api-contract", response_model=KPIApiContract)
async def get_kpi_api_contract(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return the operation contract for API entry mode: request we send and response we expect."""
    org_id = _org_id(current_user, organization_id)
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    fields_orm = await list_kpi_fields(db, kpi_id, org_id)
    contract_fields: list[KPIApiContractField] = []
    example_values: dict = {}
    for f in fields_orm:
        ft_str = _field_type_str(f)
        sub_keys = []
        if ft_str == "multi_line_items":
            for s in getattr(f, "sub_fields", None) or []:
                sub_keys.append(getattr(s, "key", ""))
        ex = _example_value_for_field(f)  # None for formula
        accepted_hint = "true, false, 1, or 0" if ft_str == "boolean" else None
        contract_fields.append(
            KPIApiContractField(
                key=f.key,
                name=f.name,
                field_type=ft_str,
                sub_field_keys=sub_keys,
                example_value=ex,
                accepted_value_hint=accepted_hint,
            )
        )
        # Only non-formula fields go in response values (API must not send formula; we compute it)
        if ft_str != "formula":
            example_values[f.key] = ex
    example_year = 2025
    return KPIApiContract(
        example_request_body={
            "year": example_year,
            "kpi_id": kpi_id,
            "organization_id": org_id,
        },
        fields=contract_fields,
        example_response={
            "year": example_year,
            "values": example_values,
        },
    )


@router.post("/{kpi_id}/sync-from-api")
async def sync_kpi_from_api_route(
    kpi_id: int,
    year: int = Query(..., ge=2000, le=2100),
    organization_id: int | None = Query(None),
    force_override: bool = Query(True, description="Overwrite existing entry when API returns override_existing=false"),
    sync_mode: str = Query("override", description="override = replace; append = append to multi_line_items"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Call the KPI's API endpoint to fetch entry data for the given year and apply it."""
    org_id = _org_id(current_user, organization_id)
    result = await sync_kpi_entry_from_api(
        db, kpi_id, org_id, year, current_user.id, force_override=force_override, sync_mode=sync_mode
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="KPI not found, not in API mode, API endpoint not set, or API call failed",
        )
    await db.commit()
    return result

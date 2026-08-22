"""Odoo endpoints management service."""

from __future__ import annotations

import httpx
from typing import Any
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import OdooEndpoint, OrganizationOdooConfig, KpiOdooConfig, KPI
from app.odoo.config_service import get_org_odoo_config
from app.odoo.service import odoo_authenticate


async def ensure_default_odoo_endpoint(db: AsyncSession, org_id: int) -> OdooEndpoint | None:
    """If organization has an old data_fetch_url in OrganizationOdooConfig but no OdooEndpoints,
    automatically create a 'Default Odoo API' endpoint and link existing KpiOdooConfigs to it."""
    cfg = await get_org_odoo_config(db, org_id)
    if not cfg or not cfg.data_fetch_url:
        return None

    # Check existing endpoints for this org
    result = await db.execute(
        select(OdooEndpoint).where(OdooEndpoint.organization_id == org_id)
    )
    endpoints = result.scalars().all()

    if endpoints:
        return endpoints[0]

    # Create default endpoint using existing fetch URL
    default_ep = OdooEndpoint(
        organization_id=org_id,
        name="Default Odoo API",
        url=cfg.data_fetch_url.strip(),
        description="Automatically created from organization single endpoint settings",
        is_active=True,
    )
    db.add(default_ep)
    await db.flush()
    await db.refresh(default_ep)

    # Link existing KpiOdooConfigs belonging to this organization to this default endpoint
    kpis_res = await db.execute(select(KPI.id).where(KPI.organization_id == org_id))
    kpi_ids = kpis_res.scalars().all()
    if kpi_ids:
        kpi_cfgs_res = await db.execute(
            select(KpiOdooConfig).where(
                KpiOdooConfig.kpi_id.in_(kpi_ids),
                KpiOdooConfig.odoo_endpoint_id.is_(None),
            )
        )
        for k_cfg in kpi_cfgs_res.scalars().all():
            k_cfg.odoo_endpoint_id = default_ep.id

        await db.flush()

    return default_ep


async def get_org_odoo_endpoints(
    db: AsyncSession, org_id: int, active_only: bool = False
) -> list[OdooEndpoint]:
    """Get all Odoo endpoints for an organization (auto-migrating default endpoint if needed)."""
    stmt = select(OdooEndpoint).where(OdooEndpoint.organization_id == org_id)
    if active_only:
        stmt = stmt.where(OdooEndpoint.is_active.is_(True))
    stmt = stmt.order_by(OdooEndpoint.created_at.asc())

    res = await db.execute(stmt)
    eps = res.scalars().all()

    if not eps:
        def_ep = await ensure_default_odoo_endpoint(db, org_id)
        if def_ep:
            if active_only and not def_ep.is_active:
                return []
            return [def_ep]
        return []

    return eps


async def get_odoo_endpoint_by_id(
    db: AsyncSession, endpoint_id: int
) -> OdooEndpoint | None:
    res = await db.execute(select(OdooEndpoint).where(OdooEndpoint.id == endpoint_id))
    return res.scalar_one_or_none()


async def create_odoo_endpoint(
    db: AsyncSession,
    org_id: int,
    name: str,
    url: str,
    description: str | None = None,
    is_active: bool = True,
) -> OdooEndpoint:
    ep = OdooEndpoint(
        organization_id=org_id,
        name=name.strip(),
        url="".join((url or "").split()),
        description=(description or "").strip() or None,
        is_active=is_active,
    )
    db.add(ep)
    await db.flush()
    await db.refresh(ep)
    return ep


async def update_odoo_endpoint(
    db: AsyncSession,
    endpoint: OdooEndpoint,
    name: str | None = None,
    url: str | None = None,
    description: str | None = None,
    is_active: bool | None = None,
) -> OdooEndpoint:
    if name is not None:
        endpoint.name = name.strip()
    if url is not None:
        endpoint.url = "".join((url or "").split())
    if description is not None:
        endpoint.description = description.strip() or None
    if is_active is not None:
        endpoint.is_active = is_active

    await db.flush()
    await db.refresh(endpoint)
    return endpoint


async def count_kpis_using_endpoint(db: AsyncSession, endpoint_id: int) -> int:
    """Return count of KpiOdooConfigs referencing this endpoint."""
    res = await db.execute(
        select(func.count(KpiOdooConfig.id)).where(
            KpiOdooConfig.odoo_endpoint_id == endpoint_id
        )
    )
    return res.scalar_one() or 0


async def delete_odoo_endpoint(db: AsyncSession, endpoint: OdooEndpoint) -> None:
    """Delete an OdooEndpoint if it is not referenced by any KPIs."""
    usage_count = await count_kpis_using_endpoint(db, endpoint.id)
    if usage_count > 0:
        raise ValueError(
            f"This endpoint '{endpoint.name}' is currently used by {usage_count} KPI(s) and cannot be deleted. Please deactivate it or assign those KPIs to a different endpoint."
        )

    await db.delete(endpoint)
    await db.flush()


async def test_odoo_endpoint_connection(
    db: AsyncSession, org_id: int, url: str
) -> dict[str, Any]:
    """Test connecting to a specific Odoo endpoint using org's central Odoo credentials."""
    cfg = await get_org_odoo_config(db, org_id)
    if not cfg:
        return {"success": False, "message": "Odoo connection is not configured for this organization"}

    url = (url or "").strip()
    if not url:
        return {"success": False, "message": "Endpoint URL is required"}

    try:
        session_id = await odoo_authenticate(cfg)
    except Exception as e:
        return {"success": False, "message": f"Odoo login failed: {str(e)}"}

    headers = {"Content-Type": "application/json"}
    cookies = {"session_id": session_id}
    test_payload = {"session_id": session_id, "params": {}}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url, json=test_payload, headers=headers, cookies=cookies
            )
        if 200 <= resp.status_code < 300:
            return {"success": True, "message": f"Endpoint connection successful (HTTP {resp.status_code})"}
        else:
            return {
                "success": False,
                "message": f"Endpoint connection failed (HTTP {resp.status_code})",
            }
    except Exception as e:
        return {"success": False, "message": f"Unable to connect to endpoint: {str(e)}"}

"""Odoo configuration persistence."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import OrganizationOdooConfig, KpiOdooConfig, KPI


async def get_org_odoo_config(db: AsyncSession, org_id: int) -> OrganizationOdooConfig | None:
    result = await db.execute(
        select(OrganizationOdooConfig).where(OrganizationOdooConfig.organization_id == org_id)
    )
    return result.scalar_one_or_none()


async def upsert_org_odoo_config(
    db: AsyncSession,
    org_id: int,
    login_url: str,
    data_fetch_url: str,
    odoo_db: str | None,
    username: str,
    password: str,
) -> OrganizationOdooConfig:
    cfg = await get_org_odoo_config(db, org_id)
    if cfg is None:
        cfg = OrganizationOdooConfig(
            organization_id=org_id,
            login_url=login_url,
            data_fetch_url=data_fetch_url,
            odoo_db=odoo_db,
            username=username,
            password=password,
        )
        db.add(cfg)
    else:
        cfg.login_url = login_url
        cfg.data_fetch_url = data_fetch_url
        cfg.odoo_db = odoo_db
        cfg.username = username
        if password and password != "***":
            cfg.password = password
    await db.flush()
    await db.refresh(cfg)
    return cfg


async def get_kpi_odoo_config(db: AsyncSession, kpi_id: int) -> KpiOdooConfig | None:
    result = await db.execute(select(KpiOdooConfig).where(KpiOdooConfig.kpi_id == kpi_id))
    return result.scalar_one_or_none()


async def upsert_kpi_odoo_config(
    db: AsyncSession,
    kpi_id: int,
    request_body: dict | list,
    response_items_path: str | None,
) -> KpiOdooConfig:
    cfg = await get_kpi_odoo_config(db, kpi_id)
    if cfg is None:
        cfg = KpiOdooConfig(
            kpi_id=kpi_id,
            request_body=request_body,
            response_items_path=response_items_path,
        )
        db.add(cfg)
    else:
        cfg.request_body = request_body
        cfg.response_items_path = response_items_path
    await db.flush()
    await db.refresh(cfg)
    return cfg


async def kpi_belongs_to_org(db: AsyncSession, kpi_id: int, org_id: int) -> bool:
    result = await db.execute(select(KPI.id).where(KPI.id == kpi_id, KPI.organization_id == org_id))
    return result.scalar_one_or_none() is not None

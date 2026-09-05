"""Auth service: login, refresh, user resolution."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import httpx

from app.core.models import User
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.config import get_settings

settings = get_settings()


async def _verify_external_credentials(login_url: str, db_name: str, username: str, password: str) -> bool:
    """
    Verify credentials against the external server (JSON-RPC).

    Current implementation matches the provided example:
      POST <login_url>
      { "params": { "db": "<db_name>", "login": "<username>", "password": "<password>" } }
    Success is when the response includes `result.user_context.uid` (or `result.uid`).
    """
    payload = {
        "jsonrpc": "2.0",
        "params": {
            "db": db_name,
            "login": username,
            "password": password,
        },
        "id": None,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False, follow_redirects=True) as client:
            resp = await client.post(login_url, json=payload)
        if resp.status_code < 200 or resp.status_code >= 300:
            return False
        data = resp.json()
    except Exception:
        return False

    result = data.get("result")
    if not result:
        return False
    user_context = result.get("user_context") or {}
    uid = user_context.get("uid") or result.get("uid")
    try:
        return uid is not None and uid is not False and int(uid) > 0
    except Exception:
        return bool(uid)


async def authenticate_user(db: AsyncSession, username: str, password: str) -> User | None:
    """
    Authenticate by username and password.
    Super admin is looked up with organization_id IS NULL; org users by username + org.
    """
    from app.core.models import ExternalAuthConfig, ExternalUser, OrganizationOdooConfig

    result = await db.execute(
        select(User).where(User.username == username).order_by(User.organization_id.desc().nulls_last())
    )
    users = result.scalars().all()
    if not users:
        return None

    # Load external auth config (global fallback).
    ext_cfg_res = await db.execute(select(ExternalAuthConfig).order_by(ExternalAuthConfig.id).limit(1))
    ext_cfg = ext_cfg_res.scalar_one_or_none()

    user_ids = [u.id for u in users]
    ext_users_res = await db.execute(select(ExternalUser).where(ExternalUser.user_id.in_(user_ids)))
    ext_users = ext_users_res.scalars().all()
    ext_user_by_id = {eu.user_id: eu for eu in ext_users}

    org_ids = list({u.organization_id for u in users if u.organization_id is not None})
    org_odoo_map: dict[int, OrganizationOdooConfig] = {}
    if org_ids:
        org_odoo_res = await db.execute(
            select(OrganizationOdooConfig).where(OrganizationOdooConfig.organization_id.in_(org_ids))
        )
        for o_cfg in org_odoo_res.scalars().all():
            org_odoo_map[o_cfg.organization_id] = o_cfg

    for user in users:
        if not user.is_active:
            continue

        if user.id in ext_user_by_id:
            login_url = None
            db_name = "OBE"

            # 1. Primary: Check organization-specific Odoo config
            if user.organization_id and user.organization_id in org_odoo_map:
                o_cfg = org_odoo_map[user.organization_id]
                if o_cfg.login_url:
                    login_url = o_cfg.login_url
                    db_name = o_cfg.odoo_db or "OBE"

            # 2. Fallback to global external auth config
            if not login_url and ext_cfg and ext_cfg.login_url:
                login_url = ext_cfg.login_url
                db_name = ext_cfg.db_name or "OBE"

            if not login_url:
                continue

            ok = await _verify_external_credentials(
                login_url,
                db_name,
                username,
                password,
            )
            if ok:
                return user
        else:
            if verify_password(password, user.hashed_password):
                return user
    return None


async def get_external_auth_config(db: AsyncSession) -> "ExternalAuthConfig | None":
    """Return the first (single) external auth config row, if any."""
    from app.core.models import ExternalAuthConfig

    res = await db.execute(select(ExternalAuthConfig).order_by(ExternalAuthConfig.id).limit(1))
    return res.scalar_one_or_none()


async def upsert_external_auth_config(db: AsyncSession, login_url: str, db_name: str) -> "ExternalAuthConfig":
    """Create or update the single external auth config row."""
    from app.core.models import ExternalAuthConfig

    cfg = await get_external_auth_config(db)
    if cfg is None:
        cfg = ExternalAuthConfig(login_url=login_url, db_name=db_name)
        db.add(cfg)
        await db.flush()
        return cfg
    cfg.login_url = login_url
    cfg.db_name = db_name
    await db.flush()
    return cfg


def create_tokens_for_user(user: User) -> tuple[str, str, int, bool]:
    """Create access and refresh tokens; return (access, refresh, expires_in_seconds, force_password_reset)."""
    extra = {
        "role": user.role.value,
        "organization_id": user.organization_id,
        "force_password_reset": bool(user.force_password_reset),
    }
    access = create_access_token(user.id, extra=extra)
    refresh = create_refresh_token(user.id)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    return access, refresh, expires_in, bool(user.force_password_reset)


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Fetch user by id."""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> tuple[str, str, int, bool] | None:
    """Validate refresh token and return new access, refresh, expires_in, force_password_reset or None."""
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = await get_user_by_id(db, int(user_id))
    if not user or not user.is_active:
        return None
    return create_tokens_for_user(user)

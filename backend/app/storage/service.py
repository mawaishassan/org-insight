"""Storage service: load org config and delegate to backends."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.models import OrganizationStorageConfig
from app.storage.backends import upload as backend_upload, delete as backend_delete, get_stream as backend_get_stream
from app.core.config import get_settings


async def get_config(db: AsyncSession, organization_id: int) -> OrganizationStorageConfig | None:
    result = await db.execute(
        select(OrganizationStorageConfig).where(OrganizationStorageConfig.organization_id == organization_id)
    )
    return result.scalar_one_or_none()


async def upload_file(
    db: AsyncSession,
    organization_id: int,
    relative_path: str,
    content: bytes,
    content_type: str,
) -> str:
    config = await get_config(db, organization_id)
    if not config:
        # Fallback to default local storage when org-level config is missing.
        # This keeps uploads functional out-of-the-box under backend/uploads.
        settings = get_settings()
        return backend_upload(
            "local",
            {"base_path": settings.UPLOAD_BASE_PATH},
            relative_path,
            content,
            content_type or "application/octet-stream",
        )
    params = config.params or {}
    return backend_upload(config.storage_type, params, relative_path, content, content_type or "application/octet-stream")


async def delete_file(db: AsyncSession, organization_id: int, stored_path: str) -> None:
    config = await get_config(db, organization_id)
    if not config:
        settings = get_settings()
        backend_delete("local", {"base_path": settings.UPLOAD_BASE_PATH}, stored_path)
        return
    params = config.params or {}
    backend_delete(config.storage_type, params, stored_path)


async def get_file_stream(db: AsyncSession, organization_id: int, stored_path: str) -> bytes:
    config = await get_config(db, organization_id)
    if not config:
        settings = get_settings()
        return backend_get_stream("local", {"base_path": settings.UPLOAD_BASE_PATH}, stored_path)
    params = config.params or {}
    return backend_get_stream(config.storage_type, params, stored_path)

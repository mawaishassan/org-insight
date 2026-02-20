"""Storage backend adapters: local, GCS, FTP, S3, OneDrive. Params are type-specific dicts."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from app.core.config import get_settings


def _local_upload(base_path: str, relative_path: str, content: bytes, _content_type: str) -> str:
    full = Path(base_path) / relative_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(content)
    return relative_path.replace("\\", "/")


def _local_delete(base_path: str, stored_path: str) -> None:
    full = Path(base_path) / stored_path
    if full.is_file():
        full.unlink()


def _local_get_stream(base_path: str, stored_path: str) -> bytes:
    full = Path(base_path) / stored_path
    if not full.is_file():
        raise FileNotFoundError(stored_path)
    return full.read_bytes()


def _gcs_upload(params: dict[str, Any], relative_path: str, content: bytes, content_type: str) -> str:
    try:
        from google.cloud import storage
    except ImportError:
        raise RuntimeError("Google Cloud Storage not installed. Run: pip install google-cloud-storage")
    bucket_name = params.get("bucket_name") or params.get("bucket")
    if not bucket_name:
        raise ValueError("GCS params must include bucket_name")
    client = storage.Client.from_service_account_json(params["credentials_path"]) if params.get("credentials_path") else storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(relative_path)
    blob.upload_from_string(content, content_type=content_type or "application/octet-stream")
    return relative_path


def _gcs_delete(params: dict[str, Any], stored_path: str) -> None:
    try:
        from google.cloud import storage
    except ImportError:
        raise RuntimeError("Google Cloud Storage not installed. Run: pip install google-cloud-storage")
    bucket_name = params.get("bucket_name") or params.get("bucket")
    client = storage.Client.from_service_account_json(params["credentials_path"]) if params.get("credentials_path") else storage.Client()
    bucket = client.bucket(bucket_name)
    bucket.blob(stored_path).delete()


def _gcs_get_stream(params: dict[str, Any], stored_path: str) -> bytes:
    try:
        from google.cloud import storage
    except ImportError:
        raise RuntimeError("Google Cloud Storage not installed. Run: pip install google-cloud-storage")
    bucket_name = params.get("bucket_name") or params.get("bucket")
    client = storage.Client.from_service_account_json(params["credentials_path"]) if params.get("credentials_path") else storage.Client()
    bucket = client.bucket(bucket_name)
    return bucket.blob(stored_path).download_as_bytes()


def _s3_upload(params: dict[str, Any], relative_path: str, content: bytes, content_type: str) -> str:
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        raise RuntimeError("AWS SDK not installed. Run: pip install boto3")
    bucket = params.get("bucket")
    if not bucket:
        raise ValueError("S3 params must include bucket")
    region = params.get("region") or "us-east-1"
    kwargs = {"service_name": "s3", "region_name": region}
    if params.get("access_key_id") and params.get("secret_access_key"):
        kwargs["aws_access_key_id"] = params["access_key_id"]
        kwargs["aws_secret_access_key"] = params["secret_access_key"]
    client = boto3.client(**kwargs)
    client.put_object(Bucket=bucket, Key=relative_path, Body=content, ContentType=content_type or "application/octet-stream")
    return relative_path


def _s3_delete(params: dict[str, Any], stored_path: str) -> None:
    try:
        import boto3
    except ImportError:
        raise RuntimeError("AWS SDK not installed. Run: pip install boto3")
    bucket = params.get("bucket")
    region = params.get("region") or "us-east-1"
    kwargs = {"service_name": "s3", "region_name": region}
    if params.get("access_key_id") and params.get("secret_access_key"):
        kwargs["aws_access_key_id"] = params["access_key_id"]
        kwargs["aws_secret_access_key"] = params["secret_access_key"]
    client = boto3.client(**kwargs)
    client.delete_object(Bucket=bucket, Key=stored_path)


def _s3_get_stream(params: dict[str, Any], stored_path: str) -> bytes:
    try:
        import boto3
    except ImportError:
        raise RuntimeError("AWS SDK not installed. Run: pip install boto3")
    bucket = params.get("bucket")
    region = params.get("region") or "us-east-1"
    kwargs = {"service_name": "s3", "region_name": region}
    if params.get("access_key_id") and params.get("secret_access_key"):
        kwargs["aws_access_key_id"] = params["access_key_id"]
        kwargs["aws_secret_access_key"] = params["secret_access_key"]
    client = boto3.client(**kwargs)
    resp = client.get_object(Bucket=bucket, Key=stored_path)
    return resp["Body"].read()


def _ftp_upload(_params: dict[str, Any], _relative_path: str, _content: bytes, _content_type: str) -> str:
    raise NotImplementedError("FTP storage: install ftplib support or use a third-party package (e.g. ftputil)")


def _ftp_delete(_params: dict[str, Any], _stored_path: str) -> None:
    raise NotImplementedError("FTP storage not implemented")


def _ftp_get_stream(_params: dict[str, Any], _stored_path: str) -> bytes:
    raise NotImplementedError("FTP storage not implemented")


def _onedrive_upload(_params: dict[str, Any], _relative_path: str, _content: bytes, _content_type: str) -> str:
    raise NotImplementedError("OneDrive storage: requires OAuth/app integration; not implemented")


def _onedrive_delete(_params: dict[str, Any], _stored_path: str) -> None:
    raise NotImplementedError("OneDrive storage not implemented")


def _onedrive_get_stream(_params: dict[str, Any], _stored_path: str) -> bytes:
    raise NotImplementedError("OneDrive storage not implemented")


_UPLOAD = {
    "local": lambda p, rp, c, ct: _local_upload(p.get("base_path") or get_settings().UPLOAD_BASE_PATH, rp, c, ct),
    "gcs": _gcs_upload,
    "s3": _s3_upload,
    "ftp": _ftp_upload,
    "onedrive": _onedrive_upload,
}
_DELETE = {
    "local": lambda p, sp: _local_delete(p.get("base_path") or get_settings().UPLOAD_BASE_PATH, sp),
    "gcs": _gcs_delete,
    "s3": _s3_delete,
    "ftp": _ftp_delete,
    "onedrive": _onedrive_delete,
}
_GET_STREAM = {
    "local": lambda p, sp: _local_get_stream(p.get("base_path") or get_settings().UPLOAD_BASE_PATH, sp),
    "gcs": _gcs_get_stream,
    "s3": _s3_get_stream,
    "ftp": _ftp_get_stream,
    "onedrive": _onedrive_get_stream,
}


def upload(storage_type: str, params: dict[str, Any] | None, relative_path: str, content: bytes, content_type: str) -> str:
    if not params:
        params = {}
    handler = _UPLOAD.get(storage_type)
    if not handler:
        raise ValueError(f"Unknown storage_type: {storage_type}")
    return handler(params, relative_path, content, content_type or "application/octet-stream")


def delete(storage_type: str, params: dict[str, Any] | None, stored_path: str) -> None:
    if not params:
        params = {}
    handler = _DELETE.get(storage_type)
    if not handler:
        raise ValueError(f"Unknown storage_type: {storage_type}")
    handler(params, stored_path)


def get_stream(storage_type: str, params: dict[str, Any] | None, stored_path: str) -> bytes:
    if not params:
        params = {}
    handler = _GET_STREAM.get(storage_type)
    if not handler:
        raise ValueError(f"Unknown storage_type: {storage_type}")
    return handler(params, stored_path)

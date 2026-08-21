import datetime
import threading
from typing import Dict, Any, Tuple

# Thread-safe global store for tracking Odoo sync stages.
# Key: (entity_type, entity_id), e.g. ("kpi_entry", 123) or ("dashboard", 456)
# Value: {"stage": str, "updated_at": str}
_SYNC_STATUSES: Dict[Tuple[str, int], Dict[str, Any]] = {}
_lock = threading.Lock()


def set_sync_stage(entity_type: str, entity_id: int, stage: str) -> None:
    """Update the current execution stage for a sync task."""
    key = (entity_type.strip().lower(), int(entity_id))
    now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with _lock:
        _SYNC_STATUSES[key] = {
            "stage": stage.strip().upper(),
            "updated_at": now_str,
        }


def get_sync_stage(entity_type: str, entity_id: int) -> Dict[str, Any]:
    """Retrieve the last recorded stage for a sync task."""
    key = (entity_type.strip().lower(), int(entity_id))
    with _lock:
        status = _SYNC_STATUSES.get(key)
    if not status:
        return {"stage": "IDLE", "updated_at": None}
    return status


def clear_sync_stage(entity_type: str, entity_id: int) -> None:
    """Clear the sync stage once completed or failed."""
    key = (entity_type.strip().lower(), int(entity_id))
    with _lock:
        if key in _SYNC_STATUSES:
            del _SYNC_STATUSES[key]

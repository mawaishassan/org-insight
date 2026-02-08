"""Chat API routes (org admin only)."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_org_admin, require_tenant
from app.chat.schemas import ChatMessageRequest, ChatMessageResponse
from app.chat.service import run_chat_turn
from app.core.database import get_db
from app.core.models import User

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/message", response_model=ChatMessageResponse)
async def chat_message(
    body: ChatMessageRequest,
    current_user: User = Depends(require_org_admin),
    _tenant: User = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Send a natural language query about organization KPI data.
    Available to organization admins only. Returns NLP summary and source links to KPI entry pages.
    """
    org_id = current_user.organization_id
    if not org_id:
        return ChatMessageResponse(
            text="You are not associated with an organization. Only organization admins can use chat.",
            not_collected=False,
        )
    result = await run_chat_turn(db, org_id, body.message)
    return ChatMessageResponse(**result)

"""API routes for MLI text extraction symbols and rules.

All endpoints require SUPER_ADMIN role.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.models import MLIExtractionSymbol, MLITextExtractionRule, UserRole
from app.entries.mli_extraction import apply_extraction_rules
from app.entries.mli_extraction_schemas import (
    RuleCreate,
    RuleOut,
    RulePreviewRequest,
    RulePreviewResponse,
    RuleReorder,
    RuleUpdate,
    SymbolCreate,
    SymbolOut,
    SymbolUpdate,
)

router = APIRouter(tags=["mli-extraction"])


def _require_super_admin(current_user=Depends(get_current_user)):
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin access required")
    return current_user


# ============================================================
# Symbols
# ============================================================

@router.get("/mli/symbols", response_model=List[SymbolOut])
async def list_symbols(
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    res = await db.execute(
        select(MLIExtractionSymbol).order_by(MLIExtractionSymbol.sort_order, MLIExtractionSymbol.id)
    )
    return res.scalars().all()


@router.post("/mli/symbols", response_model=SymbolOut, status_code=201)
async def create_symbol(
    payload: SymbolCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    sym = MLIExtractionSymbol(**payload.model_dump())
    db.add(sym)
    await db.commit()
    await db.refresh(sym)
    return sym


@router.patch("/mli/symbols/{symbol_id}", response_model=SymbolOut)
async def update_symbol(
    symbol_id: int,
    payload: SymbolUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    res = await db.execute(select(MLIExtractionSymbol).where(MLIExtractionSymbol.id == symbol_id))
    sym = res.scalar_one_or_none()
    if not sym:
        raise HTTPException(status_code=404, detail="Symbol not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(sym, k, v)
    await db.commit()
    await db.refresh(sym)
    return sym


@router.delete("/mli/symbols/{symbol_id}", status_code=204)
async def delete_symbol(
    symbol_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    res = await db.execute(select(MLIExtractionSymbol).where(MLIExtractionSymbol.id == symbol_id))
    sym = res.scalar_one_or_none()
    if not sym:
        raise HTTPException(status_code=404, detail="Symbol not found")
    await db.delete(sym)
    await db.commit()


# ============================================================
# Rules
# ============================================================

@router.get("/mli/fields/{field_id}/extraction-rules", response_model=List[RuleOut])
async def list_rules(
    field_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    res = await db.execute(
        select(MLITextExtractionRule)
        .where(MLITextExtractionRule.field_id == field_id)
        .order_by(MLITextExtractionRule.sort_order, MLITextExtractionRule.id)
    )
    return res.scalars().all()


@router.post("/mli/fields/{field_id}/extraction-rules", response_model=RuleOut, status_code=201)
async def create_rule(
    field_id: int,
    payload: RuleCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    # Validate no circular dependency with existing rules
    existing = await _get_active_rules_dicts(db, field_id)
    candidate = payload.model_dump()
    candidate["name"] = payload.name
    candidate["is_active"] = True
    _check_circular([*existing, candidate])

    rule = MLITextExtractionRule(field_id=field_id, **payload.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/mli/fields/{field_id}/extraction-rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    field_id: int,
    rule_id: int,
    payload: RuleUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    res = await db.execute(
        select(MLITextExtractionRule).where(
            MLITextExtractionRule.id == rule_id,
            MLITextExtractionRule.field_id == field_id,
        )
    )
    rule = res.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    for k, v in payload.model_dump().items():
        setattr(rule, k, v)

    # Re-validate circular deps with the updated rule in place
    existing = await _get_active_rules_dicts(db, field_id)
    existing = [r for r in existing if r["id"] != rule_id]
    candidate = payload.model_dump()
    candidate["id"] = rule_id
    _check_circular([*existing, candidate])

    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/mli/fields/{field_id}/extraction-rules/{rule_id}", status_code=204)
async def delete_rule(
    field_id: int,
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    res = await db.execute(
        select(MLITextExtractionRule).where(
            MLITextExtractionRule.id == rule_id,
            MLITextExtractionRule.field_id == field_id,
        )
    )
    rule = res.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()


@router.put("/mli/fields/{field_id}/extraction-rules/reorder", status_code=204)
async def reorder_rules(
    field_id: int,
    payload: RuleReorder,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    """Set sort_order for each rule based on position in the ids array."""
    for order, rule_id in enumerate(payload.ids):
        res = await db.execute(
            select(MLITextExtractionRule).where(
                MLITextExtractionRule.id == rule_id,
                MLITextExtractionRule.field_id == field_id,
            )
        )
        rule = res.scalar_one_or_none()
        if rule:
            rule.sort_order = order
    await db.commit()


@router.post("/mli/fields/{field_id}/extraction-rules/preview", response_model=RulePreviewResponse)
async def preview_rules(
    field_id: int,
    payload: RulePreviewRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(_require_super_admin),
):
    """Apply rules to sample rows (no DB writes) and return the result."""
    rules_dicts = [r.model_dump() for r in payload.rules]
    # Mark all as active for preview
    for r in rules_dicts:
        r["is_active"] = True

    try:
        result = apply_extraction_rules(payload.rows, rules_dicts)
        return RulePreviewResponse(result_rows=result)
    except ValueError as exc:
        return RulePreviewResponse(result_rows=[], error=str(exc))


# ============================================================
# Helpers
# ============================================================

async def _get_active_rules_dicts(db: AsyncSession, field_id: int) -> list[dict]:
    res = await db.execute(
        select(MLITextExtractionRule).where(
            MLITextExtractionRule.field_id == field_id,
            MLITextExtractionRule.is_active.is_(True),
        )
    )
    return [
        {
            "id": r.id,
            "name": r.name,
            "is_active": r.is_active,
            "source_sub_field_key": r.source_sub_field_key,
            "target_sub_field_key": r.target_sub_field_key,
            "extraction_method": r.extraction_method,
            "start_symbol": r.start_symbol,
            "end_symbol": r.end_symbol,
        }
        for r in res.scalars().all()
    ]


def _check_circular(rules_dicts: list[dict]) -> None:
    """Raise HTTPException 422 if a circular dependency is detected."""
    try:
        from app.entries.mli_extraction import _topological_sort
        _topological_sort(rules_dicts)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

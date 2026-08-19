from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class CustomReportHeaderResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    logo_path: str
    logo_path_2: Optional[str] = None
    main_heading: str
    sub_heading: Optional[str] = None
    font_family: Optional[str] = "Helvetica"
    font_size: Optional[int] = 16
    text_color: Optional[str] = "#1e3a8a"
    text_align: Optional[str] = "center"
    sub_font_family: Optional[str] = "Helvetica"
    sub_font_size: Optional[int] = 11
    sub_text_color: Optional[str] = "#4b5563"
    sub_text_align: Optional[str] = "center"
    kpi_name_color: Optional[str] = "#1e3a8a"
    created_at: datetime
    updated_at: datetime
    logo_url: str
    logo_url_2: Optional[str] = None

    @classmethod
    def from_model(cls, model) -> "CustomReportHeaderResponse":
        _font_family = getattr(model, "font_family", None)
        _font_size = getattr(model, "font_size", None)
        _text_color = getattr(model, "text_color", None)
        _text_align = getattr(model, "text_align", None)
        _sub_font_family = getattr(model, "sub_font_family", None)
        _sub_font_size = getattr(model, "sub_font_size", None)
        _sub_text_color = getattr(model, "sub_text_color", None)
        _sub_text_align = getattr(model, "sub_text_align", None)
        _kpi_name_color = getattr(model, "kpi_name_color", None)
        _logo_path_2 = getattr(model, "logo_path_2", None)
        return cls(
            id=model.id,
            organization_id=model.organization_id,
            name=model.name,
            logo_path=model.logo_path,
            logo_path_2=_logo_path_2,
            main_heading=model.main_heading,
            sub_heading=model.sub_heading,
            font_family=_font_family if _font_family is not None else "Helvetica",
            font_size=_font_size if _font_size is not None else 16,
            text_color=_text_color if _text_color is not None else "#1e3a8a",
            text_align=_text_align if _text_align is not None else "center",
            sub_font_family=_sub_font_family if _sub_font_family is not None else "Helvetica",
            sub_font_size=_sub_font_size if _sub_font_size is not None else 11,
            sub_text_color=_sub_text_color if _sub_text_color is not None else "#4b5563",
            sub_text_align=_sub_text_align if _sub_text_align is not None else "center",
            kpi_name_color=_kpi_name_color if _kpi_name_color is not None else "#1e3a8a",
            created_at=model.created_at,
            updated_at=model.updated_at,
            logo_url=f"/api/reports/headers/{model.id}/logo",
            logo_url_2=f"/api/reports/headers/{model.id}/logo2" if _logo_path_2 else None,
        )

    class Config:
        from_attributes = True


class OrganizationBrandingResponse(BaseModel):
    id: int
    organization_id: int
    footer_label: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class OrganizationBrandingUpsert(BaseModel):
    footer_label: str = Field(..., min_length=1, max_length=512)

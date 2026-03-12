"""SQLAlchemy models for multi-tenant VC KPI system."""

import enum
from datetime import datetime
from sqlalchemy import (
    String,
    Text,
    Boolean,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Enum,
    JSON,
    UniqueConstraint,
    Column,
)
from sqlalchemy.orm import relationship
from app.core.database import Base


def utc_now():
    """Return current UTC datetime."""
    return datetime.utcnow()


class UserRole(str, enum.Enum):
    """User role enumeration."""

    SUPER_ADMIN = "SUPER_ADMIN"
    ORG_ADMIN = "ORG_ADMIN"
    USER = "USER"
    REPORT_VIEWER = "REPORT_VIEWER"


class FieldType(str, enum.Enum):
    """KPI field type enumeration."""

    single_line_text = "single_line_text"
    multi_line_text = "multi_line_text"
    number = "number"
    date = "date"
    boolean = "boolean"
    multi_line_items = "multi_line_items"
    formula = "formula"
    reference = "reference"  # Reference/Lookup: values from another KPI field


class TimeDimension(str, enum.Enum):
    """Time granularity: multi_year, yearly, half_yearly, quarterly, monthly."""

    MULTI_YEAR = "multi_year"
    YEARLY = "yearly"
    HALF_YEARLY = "half_yearly"
    QUARTERLY = "quarterly"
    MONTHLY = "monthly"


def time_dimension_order_key(td: TimeDimension) -> int:
    """Finer = higher number. Yearly=0, Monthly=4."""
    order = (TimeDimension.YEARLY, TimeDimension.HALF_YEARLY, TimeDimension.QUARTERLY, TimeDimension.MONTHLY)
    for i, t in enumerate(order):
        if td == t:
            return i
    return -1


def time_dimension_allowed_for_kpi(kpi_td: TimeDimension | None, org_td: TimeDimension) -> bool:
    """KPI can inherit (None) or be same/finer than org. Cannot be coarser."""
    if kpi_td is None:
        return True
    return time_dimension_order_key(kpi_td) >= time_dimension_order_key(org_td)


def effective_kpi_time_dimension(kpi_td: TimeDimension | None, org_td: TimeDimension) -> TimeDimension:
    """Return KPI time dimension or org default."""
    if kpi_td is not None:
        return kpi_td
    return org_td


def period_key_sort_order(period_key: str, dimension: TimeDimension) -> int:
    """Sort key for period_key within a dimension (for consistent ordering)."""
    pk = (period_key or "").strip()
    if not pk or dimension == TimeDimension.YEARLY or dimension == TimeDimension.MULTI_YEAR:
        return 0
    if dimension == TimeDimension.HALF_YEARLY:
        return 2 if pk.upper() == "H2" else 1
    if dimension == TimeDimension.QUARTERLY:
        return {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}.get(pk.upper(), 0)
    if dimension == TimeDimension.MONTHLY and pk.isdigit():
        return int(pk) if 1 <= int(pk) <= 12 else 0
    return 0


class Organization(Base):
    """Tenant (university) model."""

    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    time_dimension = Column(
        String(32), nullable=False, default=TimeDimension.YEARLY.value, server_default=TimeDimension.YEARLY.value
    )
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    users = relationship("User", back_populates="organization", lazy="selectin")
    domains = relationship("Domain", back_populates="organization", lazy="selectin")
    kpis = relationship("KPI", back_populates="organization", lazy="selectin")
    kpi_entries = relationship("KPIEntry", back_populates="organization", lazy="selectin")
    tags = relationship("OrganizationTag", back_populates="organization", lazy="selectin", order_by="OrganizationTag.name")
    report_templates = relationship("ReportTemplate", back_populates="organization", lazy="selectin")
    export_api_tokens = relationship("ExportAPIToken", back_populates="organization", lazy="selectin")
    kpi_files = relationship("KpiFile", back_populates="organization", lazy="selectin")
    storage_config = relationship(
        "OrganizationStorageConfig",
        back_populates="organization",
        uselist=False,
        lazy="selectin",
    )


class OrganizationStorageConfig(Base):
    """One storage backend per organization (Super Admin config)."""

    __tablename__ = "organization_storage_configs"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        unique=True,
    )
    storage_type = Column(String(32), nullable=False, index=True)
    params = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    organization = relationship("Organization", back_populates="storage_config")


class ExportAPIToken(Base):
    """Long-lived token for data-export API; org admin sets validity in hours."""

    __tablename__ = "export_api_tokens"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=utc_now)
    created_by_user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    organization = relationship("Organization", back_populates="export_api_tokens")
    created_by = relationship("User", back_populates="export_api_tokens")


class OrganizationTag(Base):
    """Organization-level tag (single text); universal for the org, used to tag KPIs for search."""

    __tablename__ = "organization_tags"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_org_tag_name"),)

    organization = relationship("Organization", back_populates="tags")
    kpi_tags = relationship("KPIOrganizationTag", back_populates="tag", lazy="selectin")


class KPIOrganizationTag(Base):
    """KPI linked to an organization tag (for search/filter)."""

    __tablename__ = "kpi_organization_tags"

    id = Column(Integer, primary_key=True, index=True)
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_tag_id = Column(
        Integer, ForeignKey("organization_tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("kpi_id", "organization_tag_id", name="uq_kpi_org_tag"),)

    kpi = relationship("KPI", back_populates="organization_tags")
    tag = relationship("OrganizationTag", back_populates="kpi_tags")


class User(Base):
    """User model with tenant isolation."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    username = Column(String(100), nullable=False, index=True)
    email = Column(String(255), nullable=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.USER)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    organization = relationship("Organization", back_populates="users")
    kpi_assignments = relationship("KPIAssignment", back_populates="user", lazy="selectin")
    kpi_entries = relationship("KPIEntry", back_populates="user", lazy="selectin")
    kpi_files = relationship("KpiFile", back_populates="uploaded_by", lazy="selectin")
    report_access_permissions = relationship(
        "ReportAccessPermission", back_populates="user", lazy="selectin"
    )
    export_api_tokens = relationship("ExportAPIToken", back_populates="created_by", lazy="selectin")


class Domain(Base):
    """Domain area (Academic, Finance, Research)."""

    __tablename__ = "domains"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    organization = relationship("Organization", back_populates="domains")
    kpis = relationship("KPI", back_populates="domain", lazy="selectin")
    categories = relationship("Category", back_populates="domain", lazy="selectin", order_by="Category.sort_order")
    kpi_domains = relationship("KPIDomain", back_populates="domain", lazy="selectin")


class Category(Base):
    """Category within a domain (e.g. Undergraduate, Postgraduate under Academic)."""

    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(
        Integer, ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    domain = relationship("Domain", back_populates="categories")
    kpi_categories = relationship("KPICategory", back_populates="category", lazy="selectin")


class KPIDomain(Base):
    """KPI can be associated with multiple domains (tags)."""

    __tablename__ = "kpi_domains"

    id = Column(Integer, primary_key=True, index=True)
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    domain_id = Column(
        Integer, ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("kpi_id", "domain_id", name="uq_kpi_domain"),)

    kpi = relationship("KPI", back_populates="domain_tags")
    domain = relationship("Domain", back_populates="kpi_domains")


class KPICategory(Base):
    """KPI can be associated with multiple categories (tags)."""

    __tablename__ = "kpi_categories"

    id = Column(Integer, primary_key=True, index=True)
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id = Column(
        Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("kpi_id", "category_id", name="uq_kpi_category"),)

    kpi = relationship("KPI", back_populates="category_tags")
    category = relationship("Category", back_populates="kpi_categories")


class KPI(Base):
    """KPI definition; belongs to an organization, optionally to a primary domain (can attach domains later)."""

    __tablename__ = "kpis"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    domain_id = Column(
        Integer, ForeignKey("domains.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    year = Column(Integer, nullable=True, index=True)  # deprecated: KPI not tied to year; entries scoped by year
    sort_order = Column(Integer, default=0)
    card_display_field_ids = Column(JSON, nullable=True)  # field IDs to show on domain KPI card (order preserved)
    # Entry mode: manual (default) or api. When api, we call api_endpoint_url to fetch entry data.
    entry_mode = Column(String(20), nullable=False, default="manual", server_default="manual")
    api_endpoint_url = Column(String(2048), nullable=True)  # URL we call (GET or POST with year) to get entry payload
    time_dimension = Column(String(32), nullable=True)  # None = inherit org; else yearly, half_yearly, quarterly, monthly
    carry_forward_data = Column(Boolean, default=False, nullable=False, server_default="0")  # Non-cyclic: copy from previous period when new
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    organization = relationship("Organization", back_populates="kpis", lazy="joined")
    domain = relationship("Domain", back_populates="kpis", lazy="joined")
    domain_tags = relationship("KPIDomain", back_populates="kpi", lazy="selectin")
    category_tags = relationship("KPICategory", back_populates="kpi", lazy="selectin")
    organization_tags = relationship("KPIOrganizationTag", back_populates="kpi", lazy="selectin")
    fields = relationship("KPIField", back_populates="kpi", lazy="selectin", order_by="KPIField.sort_order")
    assignments = relationship("KPIAssignment", back_populates="kpi", lazy="selectin")
    entries = relationship("KPIEntry", back_populates="kpi", lazy="selectin")
    kpi_files = relationship("KpiFile", back_populates="kpi", lazy="selectin")
    report_template_kpis = relationship("ReportTemplateKPI", back_populates="kpi", lazy="selectin")


class KPIField(Base):
    """Dynamic field definition under a KPI."""

    __tablename__ = "kpi_fields"

    id = Column(Integer, primary_key=True, index=True)
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    key = Column(String(100), nullable=False, index=True)
    field_type = Column(Enum(FieldType), nullable=False)
    formula_expression = Column(Text, nullable=True)
    is_required = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    config = Column(JSON, nullable=True)
    carry_forward_data = Column(Boolean, default=False, nullable=False, server_default="0")  # Non-cyclic: copy from previous period when new
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    kpi = relationship("KPI", back_populates="fields")
    options = relationship("KPIFieldOption", back_populates="field", lazy="selectin")
    sub_fields = relationship(
        "KPIFieldSubField", back_populates="field", lazy="selectin", order_by="KPIFieldSubField.sort_order"
    )
    values = relationship("KPIFieldValue", back_populates="field", lazy="selectin")
    report_template_fields = relationship(
        "ReportTemplateField", back_populates="kpi_field", lazy="selectin"
    )


class KPIFieldOption(Base):
    """Options for fields (e.g. dropdown)."""

    __tablename__ = "kpi_field_options"

    id = Column(Integer, primary_key=True, index=True)
    field_id = Column(
        Integer, ForeignKey("kpi_fields.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value = Column(String(255), nullable=False)
    label = Column(String(255), nullable=False)
    sort_order = Column(Integer, default=0)

    field = relationship("KPIField", back_populates="options")


class KPIFieldSubField(Base):
    """Sub-field definition for multi_line_items KPI field (structured columns per row)."""

    __tablename__ = "kpi_field_sub_fields"

    id = Column(Integer, primary_key=True, index=True)
    field_id = Column(
        Integer, ForeignKey("kpi_fields.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    key = Column(String(100), nullable=False, index=True)
    field_type = Column(Enum(FieldType), nullable=False)  # single_line_text, number, date, boolean, reference
    is_required = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    config = Column(JSON, nullable=True)  # For reference: {"reference_source_kpi_id": int, "reference_source_field_key": str}

    field = relationship("KPIField", back_populates="sub_fields")


class KPIAssignmentType(str, enum.Enum):
    """KPI assignment permission: view (read-only) or data_entry (can edit)."""

    view = "view"
    data_entry = "data_entry"


class KPIAssignment(Base):
    """Assignment of KPI to user: view (read-only) or data_entry (can enter/edit data)."""

    __tablename__ = "kpi_assignments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assignment_type = Column(
        String(20), nullable=False, default=KPIAssignmentType.data_entry.value, server_default="data_entry"
    )
    created_at = Column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("user_id", "kpi_id", name="uq_user_kpi"),)

    user = relationship("User", back_populates="kpi_assignments")
    kpi = relationship("KPI", back_populates="assignments")


class KPIEntry(Base):
    """KPI data entry (one per organization per KPI per year per period_key). period_key '' = full year."""

    __tablename__ = "kpi_entries"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    year = Column(Integer, nullable=False, index=True)
    period_key = Column(String(8), nullable=False, default="", server_default="", index=True)
    is_draft = Column(Boolean, default=True, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)
    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "kpi_id", "year", "period_key", name="uq_kpi_entry_org_kpi_year_period"
        ),
    )

    organization = relationship("Organization", back_populates="kpi_entries")
    kpi = relationship("KPI", back_populates="entries")
    user = relationship("User", back_populates="kpi_entries")
    field_values = relationship("KPIFieldValue", back_populates="entry", lazy="selectin")
    kpi_files = relationship("KpiFile", back_populates="entry", lazy="selectin")


class KpiFile(Base):
    """File attachment for a KPI (tenant-scoped by organization_id)."""

    __tablename__ = "kpi_files"

    id = Column(Integer, primary_key=True, index=True)
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year = Column(Integer, nullable=True, index=True)
    entry_id = Column(
        Integer, ForeignKey("kpi_entries.id", ondelete="CASCADE"), nullable=True, index=True
    )
    original_filename = Column(String(512), nullable=False)
    stored_path = Column(String(2048), nullable=False)
    content_type = Column(String(255), nullable=True)
    size = Column(Integer, nullable=False)
    uploaded_by_user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at = Column(DateTime, default=utc_now)

    kpi = relationship("KPI", back_populates="kpi_files")
    organization = relationship("Organization", back_populates="kpi_files")
    entry = relationship("KPIEntry", back_populates="kpi_files")
    uploaded_by = relationship("User", back_populates="kpi_files")


class KPIFieldValue(Base):
    """Stored value for a field in an entry."""

    __tablename__ = "kpi_field_values"

    id = Column(Integer, primary_key=True, index=True)
    entry_id = Column(
        Integer, ForeignKey("kpi_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_id = Column(
        Integer, ForeignKey("kpi_fields.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value_text = Column(Text, nullable=True)
    value_number = Column(Float, nullable=True)
    value_json = Column(JSON, nullable=True)
    value_boolean = Column(Boolean, nullable=True)
    value_date = Column(DateTime, nullable=True)

    entry = relationship("KPIEntry", back_populates="field_values")
    field = relationship("KPIField", back_populates="values")


class ReportTemplate(Base):
    """Report template design (official report format)."""

    __tablename__ = "report_templates"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # Optional rich layout template (Jinja2-style) stored as raw text.
    # When present, this is used to render HTML for the report using the
    # structured KPI data produced at generation time.
    body_template = Column(Text, nullable=True)
    # Visual builder: list of block configs (JSON). When set, body_template is generated from this at render time.
    body_blocks = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    organization = relationship("Organization", back_populates="report_templates")
    kpis = relationship(
        "ReportTemplateKPI",
        back_populates="report_template",
        lazy="selectin",
        order_by="ReportTemplateKPI.sort_order",
        cascade="all, delete-orphan",
    )
    access_permissions = relationship(
        "ReportAccessPermission",
        back_populates="report_template",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    text_blocks = relationship(
        "ReportTemplateTextBlock",
        back_populates="report_template",
        lazy="selectin",
        order_by="ReportTemplateTextBlock.sort_order",
        cascade="all, delete-orphan",
    )


class ReportTemplateTextBlock(Base):
    """Custom text block in a report template (for headings/instructions/notes)."""

    __tablename__ = "report_template_text_blocks"

    id = Column(Integer, primary_key=True, index=True)
    report_template_id = Column(
        Integer, ForeignKey("report_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title = Column(String(255), nullable=True)
    content = Column(Text, nullable=False, default="")
    sort_order = Column(Integer, default=0)

    report_template = relationship("ReportTemplate", back_populates="text_blocks")


class ReportTemplateKPI(Base):
    """KPI included in a report template with layout order."""

    __tablename__ = "report_template_kpis"

    id = Column(Integer, primary_key=True, index=True)
    report_template_id = Column(
        Integer, ForeignKey("report_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kpi_id = Column(
        Integer, ForeignKey("kpis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    include_all_fields = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0)

    report_template = relationship("ReportTemplate", back_populates="kpis")
    kpi = relationship("KPI", back_populates="report_template_kpis")
    fields = relationship(
        "ReportTemplateField",
        back_populates="report_template_kpi",
        lazy="selectin",
        order_by="ReportTemplateField.sort_order",
        cascade="all, delete-orphan",
    )


class ReportTemplateField(Base):
    """Specific field included in report template (when not include_all_fields)."""

    __tablename__ = "report_template_fields"

    id = Column(Integer, primary_key=True, index=True)
    report_template_kpi_id = Column(
        Integer,
        ForeignKey("report_template_kpis.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kpi_field_id = Column(
        Integer, ForeignKey("kpi_fields.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order = Column(Integer, default=0)

    report_template_kpi = relationship("ReportTemplateKPI", back_populates="fields")
    kpi_field = relationship("KPIField", back_populates="report_template_fields")


class ReportAccessPermission(Base):
    """Permission for user to view/print a report template."""

    __tablename__ = "report_access_permissions"

    id = Column(Integer, primary_key=True, index=True)
    report_template_id = Column(
        Integer, ForeignKey("report_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    can_view = Column(Boolean, default=True, nullable=False)
    can_print = Column(Boolean, default=True, nullable=False)
    can_export = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utc_now)

    __table_args__ = (
        UniqueConstraint("report_template_id", "user_id", name="uq_report_user"),
    )

    report_template = relationship("ReportTemplate", back_populates="access_permissions")
    user = relationship("User", back_populates="report_access_permissions")

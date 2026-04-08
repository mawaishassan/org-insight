"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.entries.service import EntryValidationError
from app.auth.routes import router as auth_router
from app.organizations.routes import router as org_router
from app.users.routes import router as users_router
from app.domains.routes import router as domains_router
from app.categories.routes import router as categories_router
from app.kpis.routes import router as kpis_router
from app.org_tags.routes import router as org_tags_router
from app.fields.routes import router as fields_router
from app.entries.routes import router as entries_router
from app.reports.routes import router as reports_router
from app.chat.routes import router as chat_router
from app.dashboards.routes import router as dashboards_router

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    description="Multi-tenant SaaS for University VC KPI Collection & HEC Reporting",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(org_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(domains_router, prefix="/api")
app.include_router(categories_router, prefix="/api")
app.include_router(kpis_router, prefix="/api")
app.include_router(org_tags_router, prefix="/api/organizations")
app.include_router(fields_router, prefix="/api")
app.include_router(entries_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(dashboards_router, prefix="/api")
app.include_router(chat_router, prefix="/api")


@app.exception_handler(EntryValidationError)
async def entry_validation_exception_handler(_request, exc: EntryValidationError):
    """Return 400 with structured errors for reference validation failures."""
    return JSONResponse(
        status_code=400,
        content={"detail": "Validation failed", "errors": exc.errors},
    )


@app.get("/health")
async def health():
    """Health check for load balancers."""
    return {"status": "ok"}

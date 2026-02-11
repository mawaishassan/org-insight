# VC KPI MIS — Multi-Tenant SaaS for University VC KPI Collection & HEC Reporting

Production-grade multi-tenant SaaS where universities collect yearly VC KPI data and generate official reports for HEC submission.

## Architecture

| Layer    | Tech                          |
| -------- | ------------------------------ |
| Frontend | Next.js (App Router + TypeScript) |
| Backend  | Python FastAPI (REST API)      |
| Database | PostgreSQL                    |
| Auth     | JWT (Access + Refresh Tokens) |
| ORM      | SQLAlchemy                    |
| Validation | Pydantic                    |

## Multi-Tenant Model

- Each university = **Organization (Tenant)**. All data is tenant-isolated.

## User Roles

| Role          | Description                |
| ------------- | -------------------------- |
| SUPER_ADMIN   | Platform manager           |
| ORG_ADMIN     | University admin           |
| USER          | Data entry user            |
| REPORT_VIEWER | View & print reports only  |

## Core Modules

1. **Auth** — Login / Logout, JWT, role-based permissions, tenant resolution
2. **Organizations** (Super Admin) — Create org + admin, activate/deactivate
3. **Users** (Org Admin) — CRUD users, assign role (USER / REPORT_VIEWER), assign KPIs and report templates
4. **Domains** — Manage domain areas (Academic, Finance, Research)
5. **KPIs** — Create/update/delete KPI per domain, assign users
6. **KPI Field Builder** — Dynamic fields: single_line_text, multi_line_text, number, date, boolean, multi_line_items, formula
7. **KPI Data Entry** — Draft/submit entries; admin lock/unlock
8. **Formula Engine** — Safe evaluator (+, -, *, /, SUM, AVG, COUNT, field refs)
9. **Report Template System** — Design report format, add KPIs, choose fields or full KPI, layout order
10. **Report Access Control** — Assign templates to users; REPORT_VIEWER can view/print/export only
11. **Report Generation** — Compile data, apply formulas, export JSON / CSV / PDF-ready structure

## Project Structure

```
uni_kpi_mis/
├── backend/
│   ├── app/
│   │   ├── auth/           # JWT, login, dependencies
│   │   ├── organizations/
│   │   ├── users/
│   │   ├── domains/
│   │   ├── kpis/
│   │   ├── fields/         # KPI field builder
│   │   ├── entries/        # KPI data entry
│   │   ├── formula_engine/
│   │   ├── reports/        # templates, access, generation
│   │   ├── core/           # config, database, models, security
│   │   └── main.py
│   ├── alembic/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js App Router pages
│   │   ├── components/    # DashboardLayout, DynamicKpiForm
│   │   └── lib/           # api, auth
│   └── package.json
└── README.md
```

## Setup

### Backend

1. Create a PostgreSQL database (e.g. `uni_kpi_mis`).
2. Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` (e.g. `postgresql+asyncpg://postgres:postgres@localhost:5432/uni_kpi_mis`), `JWT_SECRET_KEY`.
3. From `backend/`:
   - `pip install -r requirements.txt`
   - `alembic upgrade head` (create tables)
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8080`

### Frontend

1. From `frontend/`:
   - `npm install`
   - `npm run dev` (default port 3000)

Next.js rewrites `/api/*` to `http://localhost:8000/api/*` when using default config.

### First Super Admin

From `backend/` (with `.env` and virtualenv active):

```bash
python -m scripts.create_super_admin
```

Enter username and password when prompted. Then log in at the frontend with that user to create organizations (each gets an org admin).

## API Overview

- `POST /api/auth/login` — Login (JSON: username, password)
- `GET /api/auth/me` — Current user (Bearer token)
- `GET/POST/PATCH/DELETE /api/organizations` — Super Admin
- `GET/POST/PATCH/DELETE /api/users` — Org Admin (optional `organization_id` for Super Admin)
- `GET/POST/PATCH/DELETE /api/domains` — Org Admin
- `GET/POST/PATCH/DELETE /api/kpis` — Org Admin
- `GET/POST/PATCH/DELETE /api/fields?kpi_id=` — Org Admin
- `GET/POST /api/entries`, `POST /api/entries/submit`, `POST /api/entries/lock` — Data entry & admin
- `GET/POST/PATCH /api/reports/templates`, `POST .../kpis`, `POST .../assign` — Report template & access
- `GET /api/reports/templates/{id}/generate?format=json|csv` — Report data (view/export permission)

## Security

- bcrypt password hashing
- JWT access + refresh tokens
- Tenant isolation on all org-scoped data
- Input validation (Pydantic)
- Safe formula parsing (no code execution)

## Engineering Rules

- Modular code, service layer, no hardcoding, docstrings, scalable for future microservices.

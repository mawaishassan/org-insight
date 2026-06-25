# VC KPI MIS — Windows Setup Guide

Step-by-step instructions to install required software and run the project on **Windows 10/11**.

---

## 1. What you are setting up

| Component | Technology | Default port |
|-----------|------------|--------------|
| Frontend | Next.js 14 (TypeScript) | **3001** |
| Backend API | Python FastAPI (Uvicorn) | **8080** |
| Database | PostgreSQL | **5432** |

The frontend proxies API calls from `/api/*` to the backend (see `frontend/next.config.js`).

---

## 2. Install required software

### 2.1 Git (optional but recommended)

1. Download **Git for Windows**: https://git-scm.com/download/win  
2. Run the installer (default options are fine).  
3. Verify in **PowerShell** or **Command Prompt**:

```powershell
git --version
```

### 2.2 Python 3.11 or 3.12

1. Download Python: https://www.python.org/downloads/windows/  
2. During installation, check **“Add python.exe to PATH”**.  
3. Verify:

```powershell
python --version
pip --version
```

> **Tip:** If `python` is not found, try `py --version` (Python Launcher for Windows).

### 2.3 Node.js (LTS)

1. Download **Node.js LTS** (v20+): https://nodejs.org/  
2. Install with default options.  
3. Verify:

```powershell
node --version
npm --version
```

### 2.4 PostgreSQL

1. Download PostgreSQL for Windows: https://www.postgresql.org/download/windows/  
2. Install PostgreSQL (remember the **postgres user password** you set).  
3. Keep the default port **5432** unless you have a conflict.  
4. Optionally install **pgAdmin** (included in the installer) to manage databases visually.  
5. Verify (adjust path if your install folder differs):

```powershell
psql --version
```

If `psql` is not in PATH, use **pgAdmin** or add PostgreSQL’s `bin` folder to PATH (e.g. `C:\Program Files\PostgreSQL\16\bin`).

---

## 3. Get the project

Clone or copy the repository to a folder without spaces if possible (spaces work but can cause occasional tooling issues):

```powershell
cd "C:\Artificial Intelligence"
git clone <your-repo-url> uni_kpi_mis
or extract the code from zip
cd uni_kpi_mis
```

If you already have the folder, open PowerShell in the project root:

```powershell
cd "C:\Artificial Intelligence\uni_kpi_mis"
```

---

## 4. Create the PostgreSQL database

### Option A — pgAdmin

1. Open **pgAdmin** → connect to your local server.  
2. Right-click **Databases** → **Create** → **Database**.  
3. Name: `uni_kpi_mis`  
4. Save.

### Option B — `psql` command line

```powershell
psql -U postgres -h localhost
```

Then in the `psql` prompt:

```sql
CREATE DATABASE uni_kpi_mis;
\q
```

---

## 5. Backend setup

All commands below assume you are in the `backend` folder.

### 5.1 Open terminal in `backend`

```powershell
cd "C:\Artificial Intelligence\uni_kpi_mis\backend"
```

### 5.2 Create and activate a virtual environment

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

If PowerShell blocks the script:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\venv\Scripts\Activate.ps1
```

Alternative (Command Prompt):

```cmd
venv\Scripts\activate.bat
```

You should see `(venv)` in your prompt.

### 5.3 Install Python dependencies

```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

### 5.4 Configure environment variables

Copy the example file and edit it:

```powershell
copy .env.example .env
notepad .env
```

Set at minimum:

```env
DATABASE_URL=postgresql+asyncpg://postgres:YOUR_PASSWORD@localhost:5432/uni_kpi_mis
JWT_SECRET_KEY=replace-with-a-long-random-secret-string
```

- Replace `YOUR_PASSWORD` with your PostgreSQL `postgres` password.  
- Use a long random string for `JWT_SECRET_KEY` in production.

Optional (chat/NLP features):

```env
OPENAI_API_KEY=sk-...
CHAT_MODEL=gpt-4o-mini
```

### 5.5 Run database migrations

Still in `backend` with the virtualenv active:

```powershell
alembic upgrade head
```

This creates all tables and indexes.

### 5.6 Create the first Super Admin user

```powershell
python -m scripts.create_super_admin
```

Enter a username and password (minimum 8 characters). Use these credentials to log in to the web app.

### 5.7 Start the backend API

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Verify the API is running:

- Browser or curl: http://localhost:8080/api/widget-data/health  
- Expected: `{"status":"ok"}` (or similar success response)

Interactive API docs: http://localhost:8080/docs

---

## 6. Frontend setup

Open a **new** terminal (keep the backend running).

### 6.1 Install dependencies

```powershell
cd "C:\Artificial Intelligence\uni_kpi_mis\frontend"
npm install
```

### 6.2 Configure environment (recommended)

```powershell
copy .env.example .env.local
notepad .env.local
```

Default content:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

Use the same port as your Uvicorn server. If the backend runs on another port, update this URL (no trailing slash).

### 6.3 Start the development server

```powershell
npm run dev
```

The app runs at: **http://localhost:3001**

Log in with the Super Admin account you created in step 5.6.

---

## 7. Quick start with `start.bat` (both servers)

From the project root, after completing backend setup (venv, `pip install`, `.env`, migrations, super admin):

```powershell
cd "C:\Artificial Intelligence\uni_kpi_mis"
start.bat
```

This opens two windows:

- **KPI Server** — backend on port **8080**  
- **KPI Client** — frontend on port **3001**

To stop both:

```powershell
stop.bat
```

> **Note:** `start.bat` assumes `uvicorn` and `npm` are available in PATH and that backend dependencies are already installed. Run section 5 and 6 once before using `start.bat` for the first time.

---

## 7.1 Production build (optional)

**Backend** — run without `--reload`:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

**Frontend**:

```powershell
cd frontend
npm run build
npm run start
```

---

## 8. First-time usage checklist

After login as Super Admin:

1. Create an **Organization** (university/tenant).  
2. Create an **Org Admin** user for that organization.  
3. Log in as Org Admin (or stay as Super Admin) to configure **Domains**, **KPIs**, and **Fields**.  
4. Assign users and enter KPI data for a given year.

---

## 9. Troubleshooting (Windows)

### `python` or `pip` not found

- Reinstall Python with **“Add to PATH”** checked, or use `py -m pip` / `py -m venv`.

### Cannot activate virtualenv (`Activate.ps1` blocked)

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Database connection errors

- Confirm PostgreSQL service is running (**Services** → `postgresql-x64-*`).  
- Check `DATABASE_URL` username, password, host, port, and database name.  
- Ensure database `uni_kpi_mis` exists.

### `alembic upgrade head` fails

- Run from the `backend` folder with venv active.  
- Ensure `DATABASE_URL` in `.env` is correct.  
- If tables are in a bad state, fix the DB or restore from backup before re-running migrations.

### Frontend cannot reach API / login fails

- Backend must be running on the port in `NEXT_PUBLIC_API_URL` (default **8080**).  
- Test: http://localhost:8080/api/widget-data/health  
- Clear browser cookies for `localhost` if tokens are stale.

### Port already in use

- Backend: change Uvicorn port, e.g. `--port 8000`, and set `NEXT_PUBLIC_API_URL=http://localhost:8000` in `frontend/.env.local`.  
- Frontend: `npm run dev` uses port **3001** (see `package.json`).

### `npm install` errors

- Use Node.js LTS (v20+).  
- Delete `frontend/node_modules` and `frontend/package-lock.json`, then run `npm install` again.

### Odoo / Excel import features

- **Odoo**: Super Admin configures organization Odoo connection and per-KPI Odoo mappings.  
- **Excel**: requires `openpyxl` (installed via `requirements.txt`).

---

## 10. Project structure (reference)

```
uni_kpi_mis/
├── backend/
│   ├── app/              # FastAPI application
│   ├── alembic/          # Database migrations
│   ├── scripts/          # e.g. create_super_admin.py
│   ├── requirements.txt
│   └── .env              # Backend secrets (create from .env.example)
├── frontend/
│   ├── src/
│   ├── package.json
│   └── .env.local        # Frontend config (create from .env.example)
├── start.bat             # Start backend + frontend (Windows)
├── stop.bat              # Stop both (Windows)
├── README.md             # Project overview
└── SETUP_README.md       # This file
```

---

## 11. Useful commands summary

| Task | Command (from correct folder) |
|------|-------------------------------|
| Activate backend venv | `.\venv\Scripts\Activate.ps1` |
| Install backend deps | `pip install -r requirements.txt` |
| Run migrations | `alembic upgrade head` |
| Create Super Admin | `python -m scripts.create_super_admin` |
| Start backend | `uvicorn app.main:app --reload --host 0.0.0.0 --port 8080` |
| Install frontend deps | `npm install` |
| Start frontend | `npm run dev` |
| Start both (Windows) | `start.bat` (from project root) |

---

For architecture and API overview, see [README.md](README.md).

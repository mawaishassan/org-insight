@echo off
title OrgInsight Launcher

echo ===================================================
echo   Starting Org-Insight Application Services
echo ===================================================

REM --- Start Backend (FastAPI on port 8080) ---
echo [1/2] Launching Backend Server on http://localhost:8080 ...
start "KPI Server" cmd /k "cd /d "%~dp0backend" && call "%~dp0backend\venv\Scripts\activate.bat" && uvicorn app.main:app --reload --host 0.0.0.0 --port 8080"

REM --- Start Frontend (Next.js on port 3001) ---
echo [2/2] Launching Frontend Client on http://localhost:3001 ...
start "KPI Client" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo ===================================================
echo   Services are running:
echo   - Backend API:  http://localhost:8080
echo   - Web UI:       http://localhost:3001
echo ===================================================

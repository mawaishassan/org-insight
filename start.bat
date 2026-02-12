@echo off


REM --- Start KPI Server (Uvicorn) ---
start "KPI Server" cmd /k ^
cd /d "%~dp0backend" ^&^& uvicorn app.main:app --reload --host 0.0.0.0 --port 8080

REM --- Start KPI Client---
@echo off
start cmd /k "title KPI Client && cd /d "%~dp0frontend" && npm run dev"



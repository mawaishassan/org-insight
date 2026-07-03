@echo off

REM --- Kill whatever is listening on the backend port (8080) ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
    taskkill /F /T /PID %%p >nul 2>&1
)

REM --- Kill whatever is listening on the frontend port (3001) ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    taskkill /F /T /PID %%p >nul 2>&1
)

REM --- Best-effort: also close the launcher windows by title, if still present ---
taskkill /FI "WINDOWTITLE eq KPI Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq KPI Client*" /T /F >nul 2>&1

echo Servers stopped.

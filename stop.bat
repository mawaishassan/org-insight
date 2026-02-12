@echo off



REM --- Kill KPI Server ---
taskkill /FI "WINDOWTITLE eq KPI Server*" /T /F

REM --- Kill KPI Client---
taskkill /FI "WINDOWTITLE eq KPI Client*" /T /F

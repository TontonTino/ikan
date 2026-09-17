@echo off
set ROOT_DIR=%~dp0

echo ==================================================
echo         DEMARRAGE DE LA PLATEFORME IKAN AI
echo ==================================================
echo.

echo [1/3] Demarrage du Backend FastAPI...
start "IKAN_API" cmd /k "cd /d %ROOT_DIR%apps\api && ..\..\..\venv\Scripts\python.exe run.py"

echo [2/3] Demarrage du Client Astro...
start "IKAN_CLIENT" cmd /k "cd /d %ROOT_DIR%apps\client && npm run dev"

echo [3/3] Demarrage du Dashboard React...
start "IKAN_DASHBOARD" cmd /k "cd /d %ROOT_DIR%apps\dashboard && npm run dev"

echo.
echo ==================================================
echo Tous les services sont lances dans 3 fenetres !
echo.
echo   API Backend: http://localhost:8000/api/v1/docs
echo   Client QR:   http://localhost:4321
echo   Dashboard:   http://localhost:5173
echo ==================================================

# ============================================================
# IKAN AI — DÉMARRAGE LOCAL
# PostgreSQL local + FastAPI + Astro + React/Vite
# ============================================================

$apiPath       = $PSScriptRoot
$clientPath    = Join-Path $apiPath "..\client"
$dashboardPath = Join-Path $apiPath "..\dashboard"

$pythonExe = "C:\Users\Hello\AppData\Local\Programs\Python\Python311\python.exe"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "        IKAN AI — ENVIRONNEMENT LOCAL             " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "PostgreSQL : localhost:5432/ikanai" -ForegroundColor Cyan
Write-Host "Backend    : http://localhost:8000" -ForegroundColor Cyan
Write-Host "API Docs   : http://localhost:8000/api/v1/docs" -ForegroundColor Cyan
Write-Host "Client     : http://localhost:4321" -ForegroundColor Cyan
Write-Host "Dashboard  : http://localhost:5173" -ForegroundColor Cyan
Write-Host ""

# Vérifications
if (-not (Test-Path "$apiPath\app\main.py")) {
    Write-Host "ERREUR : backend introuvable." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$clientPath\package.json")) {
    Write-Host "ERREUR : client introuvable." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$dashboardPath\package.json")) {
    Write-Host "ERREUR : dashboard introuvable." -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] Démarrage du Backend FastAPI..." -ForegroundColor Yellow

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$apiPath'; & '$pythonExe' -m uvicorn app.main:app --reload"
)

Start-Sleep -Seconds 2

Write-Host "[2/3] Démarrage du Client Astro..." -ForegroundColor Yellow

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$clientPath'; npm run dev"
)

Write-Host "[3/3] Démarrage du Dashboard React..." -ForegroundColor Yellow

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$dashboardPath'; npm run dev"
)

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "       LES 3 SERVICES SONT EN COURS               " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "API       : http://localhost:8000/api/v1/docs" -ForegroundColor Cyan
Write-Host "Client    : http://localhost:4321" -ForegroundColor Cyan
Write-Host "Dashboard : http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "PostgreSQL : LOCAL" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

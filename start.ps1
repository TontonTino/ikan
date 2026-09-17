$currentDir = Get-Location

if (Test-Path "$currentDir\IKAN-AI-main\apps") {
    $baseDir = "$currentDir\IKAN-AI-main"
} else {
    $baseDir = $currentDir
}

$apiPath = "$baseDir\apps\api"
$clientPath = "$baseDir\apps\client"
$dashboardPath = "$baseDir\apps\dashboard"

# Recherche de l'exécutable Python
if (Test-Path "$currentDir\venv\Scripts\python.exe") {
    $pythonExe = "$currentDir\venv\Scripts\python.exe"
} elseif (Test-Path "$baseDir\..\venv\Scripts\python.exe") {
    $pythonExe = "$baseDir\..\venv\Scripts\python.exe"
} elseif (Test-Path "$apiPath\venv\Scripts\python.exe") {
    $pythonExe = "$apiPath\venv\Scripts\python.exe"
} else {
    $pythonExe = "python"
}

Write-Host "[1/3] Démarrage du Backend FastAPI..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$apiPath'; & '$pythonExe' run.py"

Write-Host "[2/3] Démarrage du Client Astro..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$clientPath'; npm run dev"

Write-Host "[3/3] Démarrage du Dashboard React..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$dashboardPath'; npm run dev"

Write-Host "✅ Les 3 services sont démarrés !" -ForegroundColor Green

## Script de setup IKAN AI — Windows PowerShell
Write-Host "=== IKAN AI — Configuration de l'environnement ===" -ForegroundColor Green
Write-Host ""

# 1. Ajouter PostgreSQL au PATH
$env:PATH += ";C:\Program Files\PostgreSQL\17\bin"

# 2. Créer la base de données
Write-Host "[1/4] Création de la base de données PostgreSQL..." -ForegroundColor Cyan
Write-Host "    Entrez votre mot de passe PostgreSQL quand demandé."
$env:PGPASSWORD = Read-Host "Mot de passe PostgreSQL (utilisateur postgres)"
psql -U postgres -c "CREATE DATABASE ikanai;" 2>&1 | Out-Null
Write-Host "    Base de données 'ikanai' prête." -ForegroundColor Green

# Mettre à jour le .env avec le bon mot de passe
$envPath = "apps\api\.env"
$content = Get-Content $envPath -Raw
$content = $content -replace "postgresql://postgres:[^@]+@", "postgresql://postgres:$($env:PGPASSWORD)@"
Set-Content $envPath $content
Write-Host "    Fichier .env mis à jour." -ForegroundColor Green

# 3. Migrations Alembic & Seed
Write-Host "[2/5] Création des tables de base de données..." -ForegroundColor Cyan
Push-Location apps\api
.\venv\Scripts\alembic revision --autogenerate -m "init"
.\venv\Scripts\alembic upgrade head
Write-Host "    Tables créées avec succès." -ForegroundColor Green

Write-Host "[3/5] Population de la base avec les données de démonstration (Seed)..." -ForegroundColor Cyan
.\venv\Scripts\python seed.py
Pop-Location
Write-Host "    Données de démonstration insérées avec succès." -ForegroundColor Green

# 4. Installer les dépendances Node.js
Write-Host "[4/5] Installation des dépendances Node.js..." -ForegroundColor Cyan
Push-Location apps\client
npm install
Pop-Location
Push-Location apps\dashboard
npm install
Pop-Location
Write-Host "    Dépendances installées." -ForegroundColor Green

# 5. Résumé
Write-Host ""
Write-Host "=== Setup terminé ! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Pour démarrer les serveurs, ouvrez 3 terminaux :" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Terminal 1 — API Backend :" -ForegroundColor Cyan
Write-Host "    cd apps\api && .\venv\Scripts\python run.py"
Write-Host ""
Write-Host "  Terminal 2 — Client Astro (QR Code) :" -ForegroundColor Cyan
Write-Host "    cd apps\client && npm run dev"
Write-Host ""
Write-Host "  Terminal 3 — Dashboard React :" -ForegroundColor Cyan
Write-Host "    cd apps\dashboard && npm run dev"
Write-Host ""
Write-Host "  API docs : http://localhost:8000/api/v1/docs" -ForegroundColor Green
Write-Host "  Client : http://localhost:4321" -ForegroundColor Green
Write-Host "  Dashboard : http://localhost:5173" -ForegroundColor Green

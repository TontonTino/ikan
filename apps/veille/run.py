"""
Script de démarrage du microservice IKAN AI - Veille & Scraping.
Usage : python run.py
"""
import sys
from pathlib import Path

# S'assurer que le dossier apps/veille est dans sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn
from scraping_service.config import settings

if __name__ == "__main__":
    print(f"🚀 Lancement du Service de Veille IKAN AI sur http://{settings.host}:{settings.port}")
    uvicorn.run(
        "scraping_service.api:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )

"""
Script de démarrage du serveur IKAN AI FastAPI.
Usage : python run.py
"""
import sys
from pathlib import Path

# S'assurer que le dossier apps/api est dans sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn
from app.core.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.DEBUG,
    )

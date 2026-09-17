"""
Configuration de la session SQLAlchemy et connexion à PostgreSQL.
"""
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)

db_url = settings.DATABASE_URL.strip()
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

# sslmode=require systématique sur toutes les bases distantes (Render PostgreSQL)
if "localhost" not in db_url and "127.0.0.1" not in db_url and "sslmode" not in db_url:
    separator = "&" if "?" in db_url else "?"
    db_url = f"{db_url}{separator}sslmode=require"

engine = create_engine(
    db_url,
    pool_pre_ping=True,           # Vérification de la connexion avant utilisation
    pool_size=5,                   # Taille du pool de connexions
    max_overflow=10,              # Connexions supplémentaires autorisées
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Classe de base pour tous les modèles SQLAlchemy."""
    pass


def get_db():
    """Dépendance FastAPI : fournit une session de base de données sécurisée."""
    db = None
    try:
        db = SessionLocal()
        yield db
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[DB CONNECTION ERROR] {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur de connexion PostgreSQL: {str(e)}",
        )
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass

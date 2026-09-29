"""
Configuration de la session SQLAlchemy et connexion à PostgreSQL.
"""
import logging
from urllib.parse import urlparse

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)

db_url = settings.DATABASE_URL.strip()
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

# Garde-fou : un hôte Supabase connu (direct "*.supabase.co" ou pooler Supavisor
# "*.pooler.supabase.com") est une base de développement partagée, jamais la prod.
# La confondre avec la prod a déjà eu lieu dans l'autre sens (create_all() exécuté
# dessus par erreur, voir app/main.py) — ce garde empêche qu'un futur
# APP_ENV=production réglé par erreur EN LOCAL, toujours pointé sur cette même
# base, active des comportements de prod (Stripe live, etc.) sur une base partagée.
_HOTE_DB = (urlparse(db_url).hostname or "").lower()
if settings.APP_ENV != "development" and ("supabase.co" in _HOTE_DB or "supabase.com" in _HOTE_DB):
    raise RuntimeError(
        f"Configuration dangereuse : APP_ENV='{settings.APP_ENV}' (différent de "
        f"'development') mais DATABASE_URL pointe vers un hôte Supabase connu ({_HOTE_DB}). "
        "Cette base est une base de développement partagée, jamais la production. "
        "Vérifiez DATABASE_URL et APP_ENV avant de redémarrer."
    )

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
    """
    Dépendance FastAPI : fournit une session de base de données sécurisée.

    Ne capture que les vraies erreurs SQLAlchemy/PostgreSQL (connexion, transaction).
    Toute autre exception (ex: RequestValidationError levée par FastAPI quand un
    payload Pydantic est invalide) doit remonter telle quelle : FastAPI ferme les
    dépendances génératrices en renvoyant l'exception d'origine dans ce générateur
    (via .throw() au point du yield), donc un `except Exception` ici masquerait à
    tort une erreur 422 de validation derrière un faux 500 "Erreur de connexion
    PostgreSQL".
    """
    db = SessionLocal()
    try:
        yield db
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"[DB CONNECTION ERROR] {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur de connexion PostgreSQL: {str(e)}",
        )
    finally:
        try:
            db.close()
        except Exception:
            pass

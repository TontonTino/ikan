"""API HTTP du service de veille IKAN AI."""

import asyncio
from datetime import datetime, timezone
import secrets
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field, HttpUrl

from scraping_service.base import FeedbackItem
from scraping_service.config import settings
from scraping_service.core.exceptions import (
    CheckpointBlockedError,
    ExtractionError,
    PageNotFoundError,
    RateLimitError,
    SessionExpiredError,
    SessionMissingError,
    TargetValidationError,
    VeilleError,
)
from scraping_service.core.logging import logger
from scraping_service.facebook.auth import (
    check_session_active,
    inspect_storage_state,
)
from scraping_service.facebook.scraper import FacebookScraper

app = FastAPI(
    title="IKAN AI - Service de Veille",
    description="Microservice unifié de scraping et surveillance d'avis et publications sur les réseaux sociaux.",
    version="1.0.0",
)

# Configuration CORS pour intégration dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

facebook_scraper = FacebookScraper()
scrape_slots = asyncio.Semaphore(settings.max_concurrent_scrapes)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


# --- Sécurité API Key ---
async def require_api_key(provided: str | None = Depends(api_key_header)) -> None:
    if not settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="VEILLE_API_KEY non configurée sur le serveur. Veuillez la définir dans votre .env",
        )
    if not provided or not secrets.compare_digest(provided, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clé API invalide ou absente (header X-API-Key requis)",
        )


# --- Modèles de Requêtes et Réponses ---
class ScrapeRequest(BaseModel):
    target: str = Field(..., description="URL de la page Facebook cible")
    max_items: int = Field(20, ge=1, le=200, description="Nombre maximal de publications à extraire")


class ScrapeResponse(BaseModel):
    source: str
    target: str
    count: int
    scraped_at: datetime
    items: list[FeedbackItem]


class SessionStatusResponse(BaseModel):
    source: str
    valid: bool
    exists: bool
    user_id: str | None = None
    is_expired: bool = False
    expires_at: str | None = None
    message: str


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    session_facebook: bool


# --- Gestionnaires d'exceptions personnalisés ---
@app.exception_handler(VeilleError)
async def veille_exception_handler(request: Request, exc: VeilleError) -> JSONResponse:
    status_map = {
        "INVALID_TARGET": status.HTTP_400_BAD_REQUEST,
        "PAGE_NOT_FOUND": status.HTTP_404_NOT_FOUND,
        "SESSION_MISSING": status.HTTP_503_SERVICE_UNAVAILABLE,
        "SESSION_EXPIRED": status.HTTP_503_SERVICE_UNAVAILABLE,
        "CHECKPOINT_BLOCKED": status.HTTP_423_LOCKED,
        "RATE_LIMITED": status.HTTP_429_TOO_MANY_REQUESTS,
        "EXTRACTION_FAILED": status.HTTP_500_INTERNAL_SERVER_ERROR,
    }
    http_status = status_map.get(exc.error_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
    logger.error(f"VeilleError [{exc.error_code}]: {exc.message}")
    return JSONResponse(
        status_code=http_status,
        content={
            "error_code": exc.error_code,
            "message": exc.message,
            "details": exc.details,
        },
    )


# --- Endpoints ---
@app.get("/health", response_model=HealthResponse, tags=["Monitoring"])
async def health() -> HealthResponse:
    """Vérifie la santé du microservice et l'état de la session locale sans latence."""
    inspection = inspect_storage_state()
    return HealthResponse(
        status="ok",
        service="IKAN AI - Service de Veille",
        version="1.0.0",
        session_facebook=inspection.get("valid", False),
    )


@app.get(
    "/session/facebook/status",
    response_model=SessionStatusResponse,
    dependencies=[Depends(require_api_key)],
    tags=["Session"],
)
async def session_status() -> SessionStatusResponse:
    """Inspecte immédiatement la validité des cookies de session Facebook enregistrés."""
    info = inspect_storage_state()
    return SessionStatusResponse(
        source="facebook",
        valid=info.get("valid", False),
        exists=info.get("exists", False),
        user_id=info.get("user_id"),
        is_expired=info.get("is_expired", False),
        expires_at=info.get("expires_at"),
        message=info.get("message", ""),
    )


@app.post(
    "/session/facebook/validate",
    dependencies=[Depends(require_api_key)],
    tags=["Session"],
)
async def validate_session_live() -> dict[str, Any]:
    """Exécute un test de connexion headless actif sur Facebook pour vérifier le compte."""
    result = await check_session_active()
    return result


async def _execute_scrape(target: str, max_items: int) -> ScrapeResponse:
    try:
        # Acquisition du sémaphore avec timeout pour ne pas saturer le serveur
        await asyncio.wait_for(scrape_slots.acquire(), timeout=10.0)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serveur saturé : nombre maximal de scrapings simultanés atteint. Réessayez dans un instant.",
        )

    try:
        items = await facebook_scraper.fetch(target, max_items)
        return ScrapeResponse(
            source="facebook",
            target=target,
            count=len(items),
            scraped_at=datetime.now(timezone.utc),
            items=items,
        )
    finally:
        scrape_slots.release()


@app.post(
    "/scrape/facebook",
    response_model=ScrapeResponse,
    dependencies=[Depends(require_api_key)],
    tags=["Scraping"],
)
async def scrape_facebook_post(payload: ScrapeRequest) -> ScrapeResponse:
    """Lance l'extraction d'une page Facebook via un corps de requête JSON."""
    return await _execute_scrape(payload.target, payload.max_items)


@app.get(
    "/scrape/facebook",
    response_model=ScrapeResponse,
    dependencies=[Depends(require_api_key)],
    tags=["Scraping"],
)
async def scrape_facebook_get(
    target: str = Query(..., description="URL de la page Facebook à analyser"),
    max_items: int = Query(20, ge=1, le=200, description="Nombre max d'items"),
) -> ScrapeResponse:
    """Lance l'extraction d'une page Facebook via paramètres GET (compatibilité)."""
    return await _execute_scrape(target, max_items)

"""API HTTP FastAPI du service de veille IKAN AI (Meta Graph API)."""

import asyncio
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field

from scraping_service.base import FeedbackItem
from scraping_service.config import settings
from scraping_service.core.crypto import encrypt_token
from scraping_service.core.exceptions import (
    ConfigurationError,
    PageNotFoundError,
    PermissionDeniedError,
    RateLimitError,
    TargetValidationError,
    TokenExpiredError,
    TokenMissingError,
    VeilleError,
)
from scraping_service.core.feedback_store import FileFeedbackStore, validate_storage_id
from scraping_service.core.jobs import ScrapeJobTracker
from scraping_service.core.logging import logger
from scraping_service.core.oauth_state import consume_oauth_state, create_oauth_state
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage, calculate_page_attention
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.scraper import FacebookCollector
from scraping_service.facebook.tokens import inspect_and_validate_page_token
from scraping_service.services.sync import sync_all, sync_page
from scraping_service.services.token_lifecycle import check_all_pages_tokens

page_store = FilePageStore()
facebook_client_factory = FacebookGraphClient
_used_oauth_nonces: set[str] = set()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.env != "dev" and not settings.api_key:
        raise ConfigurationError(
            "VEILLE_API_KEY est obligatoire hors de l'environnement dev."
        )
    if settings.env != "dev" and not settings.state_secret:
        raise ConfigurationError("VEILLE_STATE_SECRET est obligatoire hors de l'environnement dev.")
    if settings.env != "dev" and not settings.token_encryption_key:
        raise ConfigurationError("VEILLE_TOKEN_ENCRYPTION_KEY est obligatoire hors de l'environnement dev.")
    tasks: list[asyncio.Task[None]] = []
    if settings.sync_interval_minutes > 0:
        tasks.append(asyncio.create_task(_periodic_sync()))
    if settings.token_check_interval_hours > 0:
        tasks.append(asyncio.create_task(_periodic_token_check()))
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass


async def _periodic_sync() -> None:
    while True:
        await asyncio.sleep(settings.sync_interval_minutes * 60)
        try:
            await sync_all(
                store=page_store,
                feedback_store=FileFeedbackStore(),
                client_factory=facebook_client_factory,
            )
        except RateLimitError:
            continue
        except Exception:
            logger.warning("La synchronisation planifiée a échoué.")


async def _periodic_token_check() -> None:
    while True:
        await asyncio.sleep(settings.token_check_interval_hours * 3600)
        try:
            await check_all_pages_tokens(
                store=page_store,
                client_factory=facebook_client_factory,
            )
        except Exception:
            logger.warning("Le contrôle périodique des jetons a échoué.")


app = FastAPI(
    title="IKAN AI - Service de Veille (Meta Graph API)",
    description="Microservice d'extraction et de surveillance des avis et commentaires via l'API officielle Meta Graph.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


# --- Sécurité API Key ---
async def require_api_key(provided: str | None = Depends(api_key_header)) -> None:
    if settings.is_production and not settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="La configuration de sécurité est incomplète : VEILLE_API_KEY est obligatoire en environnement de production.",
        )
    if not settings.api_key:
        return
    if not provided or not secrets.compare_digest(provided, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clé API invalide ou absente (header X-API-Key requis)",
        )


async def require_connection_api_key(provided: str | None = Depends(api_key_header)) -> None:
    """Exige une clé explicitement configurée, y compris en mode dev."""
    if not settings.api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Clé API non configurée.")
    if not provided or not secrets.compare_digest(provided, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Clé API invalide ou absente.")


# --- Modèles de Requêtes et Réponses ---
class ConnectFacebookRequest(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    return_to: str = Field(..., min_length=1, max_length=2048)


class FacebookScrapeRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=2048)
    max_items: int = Field(default=20, ge=1, le=100)


def _allowed_return_url(return_to: str) -> bool:
    parsed = urlsplit(return_to)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return False
    origin = f"{parsed.scheme}://{parsed.netloc}".lower()
    allowed = {value.rstrip("/").lower() for value in settings.allowed_return_origins}
    return origin in allowed


def _redirect_result(return_to: str, result: str, *, pages: int | None = None, code: str | None = None) -> RedirectResponse:
    parsed = urlsplit(return_to)
    query = [(key, value) for key, value in parse_qsl(parsed.query) if key not in {"status", "pages", "code"}]
    query.append(("status", result))
    if pages is not None:
        query.append(("pages", str(pages)))
    if code is not None:
        query.append(("code", code))
    url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND)


# --- Gestion Globale des Exceptions ---
@app.exception_handler(VeilleError)
async def handle_veille_error(request: Request, exc: VeilleError) -> JSONResponse:
    status_map = {
        TokenMissingError: status.HTTP_401_UNAUTHORIZED,
        TokenExpiredError: status.HTTP_401_UNAUTHORIZED,
        PermissionDeniedError: status.HTTP_403_FORBIDDEN,
        TargetValidationError: status.HTTP_400_BAD_REQUEST,
        PageNotFoundError: status.HTTP_404_NOT_FOUND,
        RateLimitError: status.HTTP_429_TOO_MANY_REQUESTS,
    }
    http_status = status_map.get(type(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)
    return JSONResponse(
        status_code=http_status,
        content={
            "error_code": exc.error_code,
            "message": exc.message,
            "details": exc.details,
        },
    )


# --- Routes Principales ---
@app.get("/health", summary="Vérification de l'état du service")
async def health(
    deep: bool = False,
    provided: str | None = Depends(api_key_header),
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "ok",
        "service": "IKAN AI - Service de Veille",
        "version": "2.0.0",
        "api_meta_version": settings.fb_api_version,
    }
    if deep:
        await require_api_key(provided)
        result["connected_pages"] = len(await page_store.list_pages())
    return result


@app.post(
    "/connect/facebook/start",
    dependencies=[Depends(require_connection_api_key)],
)
async def start_facebook_connection(request: ConnectFacebookRequest) -> dict[str, str]:
    if not _allowed_return_url(request.return_to):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Origine de retour non autorisée.")
    if not settings.state_secret or not settings.fb_app_id or not settings.fb_redirect_uri:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Connexion Facebook indisponible.")

    state = create_oauth_state(request.client_id, request.return_to, settings.state_secret)
    query: dict[str, str] = {
        "client_id": settings.fb_app_id,
        "redirect_uri": settings.fb_redirect_uri,
        "state": state,
        "response_type": "code",
    }
    if settings.fb_login_config_id:
        query["config_id"] = settings.fb_login_config_id
        query["override_default_response_type"] = "true"
    else:
        query["scope"] = "pages_show_list,pages_read_engagement,pages_read_user_content"
    authorize_url = f"https://www.facebook.com/{settings.fb_api_version}/dialog/oauth?{urlencode(query)}"
    return {"authorize_url": authorize_url}


@app.get("/connect/facebook/callback")
async def facebook_callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    granted_scopes: str | None = None,
) -> RedirectResponse:
    if not settings.state_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Connexion Facebook indisponible.")
    try:
        payload = consume_oauth_state(state, settings.state_secret, _used_oauth_nonces)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="État OAuth invalide ou expiré.") from exc

    return_to = payload["return_to"]
    if error:
        return _redirect_result(return_to, "denied")
    if not code:
        return _redirect_result(return_to, "error", code="missing_code")

    graph = facebook_client_factory(access_token="")
    try:
        short_token_response = await graph.exchange_oauth_code(code)
        short_token = short_token_response.get("access_token")
        if not isinstance(short_token, str) or not short_token:
            return _redirect_result(return_to, "error", code="token_exchange_failed")
        long_token_response = await graph.exchange_for_long_lived_token(short_token)
        user_token = long_token_response.get("access_token")
        if not isinstance(user_token, str) or not user_token:
            return _redirect_result(return_to, "error", code="token_exchange_failed")
        pages = await graph.fetch_managed_pages(user_token)
        connected_count = 0
        scopes = [scope for scope in (granted_scopes or "").split(",") if scope]
        for page in pages:
            page_token = page.get("access_token")
            page_id = page.get("id")
            if not isinstance(page_token, str) or not isinstance(page_id, str):
                continue
            try:
                validation = await inspect_and_validate_page_token(page_token, client=graph)
            except TargetValidationError as exc:
                logger.warning("Jeton refusé pour la page %s : %s", page_id, exc)
                continue
            except Exception as exc:
                logger.warning("debug_token a rencontré une erreur pour la page %s : %s", page_id, exc)
                validation = {
                    "token_type": "PAGE",
                    "is_valid": True,
                    "expires_at": 0,
                    "data_access_expires_at": None,
                    "scopes": scopes,
                    "status": "active",
                    "last_error": None,
                    "token_checked_at": datetime.now(timezone.utc),
                }

            page_scopes = validation.get("scopes") or scopes
            await page_store.upsert_page(
                ConnectedPage(
                    client_id=payload["client_id"],
                    page_id=page_id,
                    page_name=str(page.get("name") or "Page Facebook"),
                    category=page.get("category") if isinstance(page.get("category"), str) else None,
                    page_token_encrypted=encrypt_token(page_token),
                    status=validation.get("status", "active"),
                    scopes=page_scopes,
                    token_type=validation.get("token_type", "PAGE"),
                    is_valid=validation.get("is_valid", True),
                    expires_at=validation.get("expires_at"),
                    data_access_expires_at=validation.get("data_access_expires_at"),
                    last_error=validation.get("last_error"),
                    reauth_reason=None,
                    token_checked_at=validation.get("token_checked_at") or datetime.now(timezone.utc),
                )
            )
            connected_count += 1
        return _redirect_result(return_to, "success", pages=connected_count)
    except Exception:
        return _redirect_result(return_to, "error", code="connection_failed")
    finally:
        await graph.aclose()


@app.get("/pages", dependencies=[Depends(require_connection_api_key)])
async def list_connected_pages(client_id: str) -> dict[str, Any]:
    try:
        pages = await page_store.list_pages(client_id=client_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifiant client invalide.") from exc
    result_pages = []
    for page in pages:
        needs_attention, reason = calculate_page_attention(
            page,
            token_warn_days=settings.token_warn_days,
            data_access_warn_days=settings.data_access_warn_days,
        )
        result_pages.append(
            {
                "id": str(page.id),
                "client_id": page.client_id,
                "page_id": page.page_id,
                "page_name": page.page_name,
                "category": page.category,
                "status": page.status,
                "scopes": page.scopes,
                "token_type": page.token_type,
                "is_valid": page.is_valid,
                "expires_at": page.expires_at,
                "data_access_expires_at": page.data_access_expires_at,
                "reauth_reason": page.reauth_reason,
                "needs_attention": needs_attention,
                "reason": reason,
                "connected_at": page.connected_at,
                "token_checked_at": page.token_checked_at,
                "last_sync_at": page.last_sync_at,
                "last_error": page.last_error,
            }
        )
    return {"pages": result_pages}


@app.get("/pages/{page_uuid}/reconnect-url", dependencies=[Depends(require_connection_api_key)])
async def get_page_reconnect_url(page_uuid: str, client_id: str, return_to: str) -> dict[str, str]:
    if not _allowed_return_url(return_to):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Origine de retour non autorisée.")
    page = await page_store.get_page(page_uuid)
    if page is None or page.client_id != client_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page introuvable.")
    if not settings.state_secret or not settings.fb_app_id or not settings.fb_redirect_uri:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Connexion Facebook indisponible.")

    state = create_oauth_state(client_id, return_to, settings.state_secret)
    query: dict[str, str] = {
        "client_id": settings.fb_app_id,
        "redirect_uri": settings.fb_redirect_uri,
        "state": state,
        "response_type": "code",
    }
    if settings.fb_login_config_id:
        query["config_id"] = settings.fb_login_config_id
        query["override_default_response_type"] = "true"
    else:
        query["scope"] = "pages_show_list,pages_read_engagement,pages_read_user_content"
    authorize_url = f"https://www.facebook.com/{settings.fb_api_version}/dialog/oauth?{urlencode(query)}"
    return {"authorize_url": authorize_url}


@app.delete("/pages/{page_uuid}", dependencies=[Depends(require_connection_api_key)])
async def delete_connected_page(page_uuid: str, client_id: str, purge: bool = False) -> dict[str, str]:
    page = await page_store.get_page(page_uuid)
    if page is None or page.client_id != client_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page introuvable.")
    revoked = await page_store.delete_page(page_uuid)
    if purge and revoked is not None:
        FileFeedbackStore().purge_page(client_id, page.page_id)
    return {"status": "revoked"}


@app.post("/pages/{page_uuid}/sync", dependencies=[Depends(require_connection_api_key)])
async def sync_connected_page(page_uuid: UUID, client_id: str) -> dict[str, Any]:
    page = await page_store.get_page(page_uuid)
    if page is None or page.client_id != client_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page introuvable.")
    return await sync_page(
        page,
        store=page_store,
        feedback_store=FileFeedbackStore(),
        client_factory=facebook_client_factory,
    )


@app.post("/sync/run", dependencies=[Depends(require_connection_api_key)])
async def run_sync() -> dict[str, Any]:
    return await sync_all(
        store=page_store,
        feedback_store=FileFeedbackStore(),
        client_factory=facebook_client_factory,
    )


@app.post("/scrape/facebook", dependencies=[Depends(require_connection_api_key)])
async def scrape_facebook(request: FacebookScrapeRequest) -> dict[str, Any]:
    """Collecte ponctuelle via le collecteur Facebook existant."""
    collector = FacebookCollector()
    try:
        items = await collector.fetch(request.target, max_items=request.max_items)
        return {
            "target": request.target,
            "count": len(items),
            "items": [item.model_dump(mode="json") for item in items],
        }
    finally:
        await collector.client.aclose()


@app.get("/feedback", dependencies=[Depends(require_connection_api_key)])
async def list_feedback(client_id: str, limit: int = 100, cursor: int = 0) -> dict[str, Any]:
    if limit < 1 or limit > 200 or cursor < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pagination invalide.")
    try:
        validate_storage_id(client_id)
        store = FileFeedbackStore()
        records = store.list_items(client_id, offset=cursor, limit=limit + 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifiant client invalide.") from exc
    has_more = len(records) > limit
    items = records[:limit]
    next_cursor = cursor + len(items) if has_more else None
    return {"items": items, "next_cursor": next_cursor}


from scraping_service.ai.pipeline import AIPipeline


class AIAnalyzeRequest(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    limit: int = Field(default=50, ge=1, le=200)


@app.post(
    "/ai/analyze",
    summary="Analyse sémantique et thématique des retours clients via le pipeline IA",
    dependencies=[Depends(require_connection_api_key)],
)
async def analyze_feedbacks_with_ai(request: AIAnalyzeRequest) -> dict[str, Any]:
    """Exécute l'analyse IA (sentiment, thème/catégorie, confiance) sur les feedbacks du client."""
    try:
        validate_storage_id(request.client_id)
        store = FileFeedbackStore()
        records = store.list_items(request.client_id, limit=request.limit)
        items = [FeedbackItem.model_validate(r) for r in records]
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifiant client invalide.") from exc

    pipeline = AIPipeline()
    analyzed = await pipeline.process_batch(items)
    return {
        "client_id": request.client_id,
        "count": len(analyzed),
        "items": [item.model_dump(mode="json") for item in analyzed],
    }

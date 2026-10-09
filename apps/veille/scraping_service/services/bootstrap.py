"""Rechargement au démarrage de la Page par défaut (hébergement à disque éphémère).

Sur un hébergement dont le disque est effacé à chaque mise en veille, state/pages.json
disparaît : la Page connectée par OAuth est perdue. Si VEILLE_FB_PAGE_ACCESS_TOKEN,
VEILLE_FB_DEFAULT_PAGE_ID et VEILLE_BOOTSTRAP_CLIENT_ID sont définies, cette Page est
réenregistrée au démarrage pour ce client, jeton chiffré comme après l'OAuth.
"""

from datetime import datetime, timezone
from typing import Any

from scraping_service.config import settings
from scraping_service.core.crypto import encrypt_token
from scraping_service.core.exceptions import ConfigurationError, VeilleError
from scraping_service.core.feedback_store import validate_storage_id
from scraping_service.core.logging import logger
from scraping_service.core.pages import ConnectedPage, PageStore
from scraping_service.facebook.client import FacebookGraphClient


async def bootstrap_default_page(
    *,
    store: PageStore,
    client_factory: Any = FacebookGraphClient,
) -> ConnectedPage | None:
    """Enregistre (ou met à jour) la Page par défaut ; ne lève jamais, ne journalise jamais le jeton."""
    token = settings.fb_page_access_token.strip()
    page_id = settings.fb_default_page_id.strip()
    client_id = settings.bootstrap_client_id.strip()
    if not (token and page_id and client_id):
        return None
    try:
        validate_storage_id(client_id)
        validate_storage_id(page_id)
    except ValueError:
        logger.warning("Amorçage de la Page ignoré : identifiant client ou Page invalide.")
        return None

    graph = client_factory(access_token=token)
    try:
        info = await graph.get_page_info(page_id)
    except VeilleError as exc:
        logger.warning("Amorçage de la Page %s impossible : Meta a refusé la lecture (%s).", page_id, exc.error_code)
        return None
    except Exception:
        logger.warning("Amorçage de la Page %s impossible : erreur inattendue.", page_id)
        return None
    finally:
        await graph.aclose()

    try:
        token_encrypted = encrypt_token(token)
    except ConfigurationError:
        logger.warning("Amorçage de la Page %s impossible : VEILLE_TOKEN_ENCRYPTION_KEY absente ou invalide.", page_id)
        return None

    existing = next((p for p in await store.list_pages(client_id=client_id) if p.page_id == page_id), None)
    page = await store.upsert_page(
        ConnectedPage(
            client_id=client_id,
            page_id=page_id,
            page_name=str(info.get("name") or "Page Facebook"),
            category=info.get("category") if isinstance(info.get("category"), str) else None,
            page_token_encrypted=token_encrypted,
            status="active",
            scopes=existing.scopes if existing else [],
            token_type="PAGE",
            is_valid=True,
            last_sync_at=existing.last_sync_at if existing else None,
            token_checked_at=datetime.now(timezone.utc),
        )
    )
    logger.info("Page %s %s pour le client %s.", page_id, "mise à jour" if existing else "enregistrée", client_id)
    return page

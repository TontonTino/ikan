"""Service d'alerte sortante par Webhook."""

from datetime import datetime, timezone
from typing import Any

import httpx

from scraping_service.config import settings
from scraping_service.core.logging import logger
from scraping_service.core.pages import ConnectedPage, PageStore


async def send_page_attention_alert(
    page: ConnectedPage,
    reason: str,
    store: PageStore | None = None,
    client: httpx.AsyncClient | None = None,
) -> bool:
    """Envoie une alerte webhook si une page requiert une attention, une seule fois par changement d'état."""
    if not settings.alert_webhook_url:
        return False

    state_key = f"{page.status}:{reason}"
    if page.last_alerted_state == state_key:
        return False

    payload: dict[str, Any] = {
        "event": "page_needs_attention",
        "client_id": page.client_id,
        "page_id": page.page_id,
        "page_name": page.page_name,
        "reason": reason,
        "status": page.status,
        "at": datetime.now(timezone.utc).isoformat(),
    }

    own_client = client is None
    http_client = client or httpx.AsyncClient(timeout=3.0)
    try:
        response = await http_client.post(settings.alert_webhook_url, json=payload)
        if response.is_success or response.status_code < 400:
            if store is not None:
                updated_page = page.model_copy(update={"last_alerted_state": state_key})
                await store.upsert_page(updated_page)
            return True
        logger.warning("Le webhook d'alerte a renvoyé un statut HTTP %s", response.status_code)
    except Exception as exc:
        logger.warning("Impossible d'envoyer l'alerte webhook : %s", exc)
    finally:
        if own_client:
            await http_client.aclose()
    return False

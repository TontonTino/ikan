"""Synchronisation incrémentale et idempotente des Pages connectées."""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from scraping_service.config import settings
from scraping_service.core.crypto import decrypt_token
from scraping_service.core.exceptions import (
    FacebookAPIError,
    PermissionDeniedError,
    RateLimitError,
    TokenExpiredError,
)
from scraping_service.core.feedback_store import FileFeedbackStore
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage, PageStore
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.scraper import FacebookCollector


_SYNC_LOCK = asyncio.Lock()


async def _sync_page_unlocked(
    page: ConnectedPage,
    *,
    store: PageStore,
    feedback_store: FileFeedbackStore,
    client_factory: Any,
) -> dict[str, Any]:
    token = decrypt_token(page.page_token_encrypted)
    graph = client_factory(access_token=token)
    collector = FacebookCollector(client=graph)
    try:
        since = datetime.now(timezone.utc) - timedelta(days=settings.lookback_days)
        items, errors = await collector.collect_page_feedback(
            page_id=page.page_id,
            limit_posts=100,
            max_comments_per_post=1000,
            since=since,
        )

        new_items = feedback_store.append_new(page.client_id, page.page_id, items)
        if errors:
            await store.set_status(str(page.id), "active", error="partial_sync")
            return {
                "page_id": page.page_id,
                "status": "partial",
                "partial": True,
                "errors": errors,
                "count": len(new_items),
            }
        await store.update_last_sync(str(page.id), datetime.now(timezone.utc))
        return {
            "page_id": page.page_id,
            "status": "success",
            "partial": False,
            "errors": [],
            "count": len(new_items),
        }
    except TokenExpiredError:
        await store.set_status(str(page.id), "reauth_required", error="token_expired")
        return {"page_id": page.page_id, "status": "reauth_required", "partial": False, "errors": ["token_expired"], "count": 0}
    except PermissionDeniedError:
        await store.set_status(str(page.id), "error", error="permission_denied")
        return {"page_id": page.page_id, "status": "error", "partial": False, "errors": ["permission_denied"], "count": 0}
    except RateLimitError:
        raise
    except FacebookAPIError:
        await store.set_status(str(page.id), "error", error="graph_request_failed")
        return {"page_id": page.page_id, "status": "error", "partial": False, "errors": ["graph_request_failed"], "count": 0}
    finally:
        await graph.aclose()


async def sync_page(
    page: ConnectedPage,
    *,
    store: PageStore | None = None,
    feedback_store: FileFeedbackStore | None = None,
    client_factory: Any = FacebookGraphClient,
) -> dict[str, Any]:
    """Synchronise une Page ; une collecte déjà en cours rend un statut ignoré."""
    if _SYNC_LOCK.locked():
        return {"page_id": page.page_id, "status": "skipped", "partial": False, "errors": [], "count": 0}
    async with _SYNC_LOCK:
        return await _sync_page_unlocked(
            page,
            store=store or FilePageStore(),
            feedback_store=feedback_store or FileFeedbackStore(),
            client_factory=client_factory,
        )


async def sync_all(
    *,
    store: PageStore | None = None,
    feedback_store: FileFeedbackStore | None = None,
    client_factory: Any = FacebookGraphClient,
) -> dict[str, Any]:
    """Synchronise séquentiellement les Pages actives, sans exécutions concurrentes."""
    if _SYNC_LOCK.locked():
        return {"status": "skipped", "pages": []}
    async with _SYNC_LOCK:
        page_store = store or FilePageStore()
        active_pages = [page for page in await page_store.list_pages() if page.status == "active"]
        results = []
        for page in active_pages:
            result = await _sync_page_unlocked(
                page,
                store=page_store,
                feedback_store=feedback_store or FileFeedbackStore(),
                client_factory=client_factory,
            )
            results.append(result)
            if result["status"] == "rate_limited":
                break
        return {"status": "success", "pages": results}
import asyncio
from datetime import datetime, timezone

import pytest
from cryptography.fernet import Fernet

from scraping_service.config import settings
from scraping_service.core.crypto import encrypt_token
from scraping_service.core.exceptions import FacebookAPIError, RateLimitError, TokenExpiredError
from scraping_service.core.feedback_store import FileFeedbackStore
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage
from scraping_service.services.sync import sync_all, sync_page


def run(coroutine):
    return asyncio.run(coroutine)


def setup_page(tmp_path, monkeypatch):
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setattr(settings, "token_encryption_key", key)
    monkeypatch.setattr(settings, "state_secret", "test-salt")
    monkeypatch.setattr(settings, "store_author_name", False)
    page = ConnectedPage(
        client_id="client-a",
        page_id="page-1",
        page_name="Page test",
        page_token_encrypted=encrypt_token("test-page-token", key),
    )
    store = FilePageStore(tmp_path / "state" / "pages.json")
    asyncio.run(store.upsert_page(page))
    feedback_store = FileFeedbackStore(tmp_path / "data", tmp_path / "state")
    return page, store, feedback_store


class FakeGraph:
    failure = None

    async def fetch_page_posts(self, page_id, limit, since):
        if self.failure == "expired":
            raise TokenExpiredError()
        if self.failure == "rate_limit":
            raise RateLimitError()
        return [{"id": "post-1", "message": "Page post"}]

    async def fetch_post_comments(self, post_id, max_comments):
        if self.failure == "partial":
            raise FacebookAPIError("safe test error")
        return [
            {
                "id": "comment-1",
                "message": "Feedback test",
                "from": {"id": "author-id", "name": "Private Name"},
            }
        ]

    async def aclose(self):
        return None


def test_successful_sync_is_idempotent_and_does_not_store_author_name(tmp_path, monkeypatch):
    page, store, feedback_store = setup_page(tmp_path, monkeypatch)

    first = run(sync_page(page, store=store, feedback_store=feedback_store, client_factory=lambda **_: FakeGraph()))
    second = run(sync_page(page, store=store, feedback_store=feedback_store, client_factory=lambda **_: FakeGraph()))

    assert first["status"] == "success"
    assert second["count"] == 0
    saved = feedback_store.list_items("client-a")[0]
    assert saved["author_name"] is None
    assert saved["author_hash"]
    assert "author-id" not in str(saved)
    assert asyncio.run(store.get_page(page.id)).last_sync_at is not None


def test_expired_token_marks_page_for_reauthentication(tmp_path, monkeypatch):
    page, store, feedback_store = setup_page(tmp_path, monkeypatch)
    FakeGraph.failure = "expired"
    try:
        result = run(sync_page(page, store=store, feedback_store=feedback_store, client_factory=lambda **_: FakeGraph()))
    finally:
        FakeGraph.failure = None

    updated = asyncio.run(store.get_page(page.id))
    assert result["status"] == "reauth_required"
    assert updated.status == "reauth_required"
    assert updated.last_error == "token_expired"


def test_rate_limit_does_not_mark_page_as_error_or_advance_last_sync(tmp_path, monkeypatch):
    page, store, feedback_store = setup_page(tmp_path, monkeypatch)
    FakeGraph.failure = "rate_limit"
    try:
        with pytest.raises(RateLimitError):
            run(sync_page(page, store=store, feedback_store=feedback_store, client_factory=lambda **_: FakeGraph()))
    finally:
        FakeGraph.failure = None

    updated = asyncio.run(store.get_page(page.id))
    assert updated.status == "active"
    assert updated.last_sync_at is None


def test_partial_sync_does_not_advance_last_sync(tmp_path, monkeypatch):
    page, store, feedback_store = setup_page(tmp_path, monkeypatch)
    FakeGraph.failure = "partial"
    try:
        result = run(sync_page(page, store=store, feedback_store=feedback_store, client_factory=lambda **_: FakeGraph()))
    finally:
        FakeGraph.failure = None

    updated = asyncio.run(store.get_page(page.id))
    assert result["partial"] is True
    assert updated.last_sync_at is None
    assert updated.last_error == "partial_sync"


class MultiPageGraph:
    """Faux client Graph : la page « page-2 » dépasse la limite de débit Meta."""

    def __init__(self, access_token=None):
        self.access_token = access_token

    async def fetch_page_posts(self, page_id, limit, since):
        if page_id == "page-2":
            raise RateLimitError("Meta rate limit reached")
        return [{"id": f"post-{page_id}", "message": "msg"}]

    async def fetch_post_comments(self, post_id, max_comments):
        return [{"id": f"comment-{post_id}", "message": "Feedback", "from": None}]

    async def aclose(self):
        return None


def _three_active_pages(tmp_path, monkeypatch):
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setattr(settings, "token_encryption_key", key)
    monkeypatch.setattr(settings, "state_secret", "test-salt")
    monkeypatch.setattr(settings, "store_author_name", False)
    store = FilePageStore(tmp_path / "state" / "pages.json")
    feedback_store = FileFeedbackStore(tmp_path / "data", tmp_path / "state")
    pages = [
        ConnectedPage(
            client_id="client-a",
            page_id=f"page-{index}",
            page_name=f"Page {index}",
            page_token_encrypted=encrypt_token(f"token-{index}", key),
        )
        for index in (1, 2, 3)
    ]
    for page in pages:
        asyncio.run(store.upsert_page(page))
    return pages, store, feedback_store


def test_sync_all_handles_rate_limit_per_page_and_keeps_earlier_results(tmp_path, monkeypatch):
    pages, store, feedback_store = _three_active_pages(tmp_path, monkeypatch)

    result = run(sync_all(store=store, feedback_store=feedback_store, client_factory=MultiPageGraph))

    assert result["status"] == "success"
    assert [entry["page_id"] for entry in result["pages"]] == ["page-1", "page-2"]
    assert result["pages"][0]["status"] == "success"
    assert result["pages"][0]["count"] == 1
    assert result["pages"][1]["status"] == "rate_limited"
    assert result["pages"][1]["errors"] == ["rate_limited"]
    # La Page limitée reste active (nouvelle tentative à la prochaine passe) et n'est pas marquée synchronisée.
    limited = run(store.get_page(pages[1].id))
    assert limited.status == "active"
    assert limited.last_sync_at is None
    # La Page précédente est bien synchronisée, la suivante n'a pas été sollicitée.
    assert run(store.get_page(pages[0].id)).last_sync_at is not None
    assert run(store.get_page(pages[2].id)).last_sync_at is None


def test_sync_page_alone_still_propagates_rate_limit(tmp_path, monkeypatch):
    pages, store, feedback_store = _three_active_pages(tmp_path, monkeypatch)

    with pytest.raises(RateLimitError):
        run(sync_page(pages[1], store=store, feedback_store=feedback_store, client_factory=MultiPageGraph))
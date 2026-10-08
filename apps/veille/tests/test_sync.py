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
from scraping_service.services.sync import sync_page


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
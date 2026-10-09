import asyncio
import logging

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

import scraping_service.api as api
from scraping_service.api import app
from scraping_service.config import settings
from scraping_service.core.crypto import decrypt_token
from scraping_service.core.page_store import FilePageStore
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.services.bootstrap import bootstrap_default_page

TOKEN = "EAAG-bootstrap-secret-page-token"
CLIENT_ID = "5f0c1d2e-0000-4000-8000-000000000001"


class FakeMeta:
    """API Graph simulée ; vérifie que le jeton ne voyage que dans l'en-tête."""

    def __init__(self, status_code=200):
        self.status_code = status_code
        self.calls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        assert TOKEN not in str(request.url)
        assert request.headers["Authorization"] == f"Bearer {TOKEN}"
        if self.status_code != 200:
            return httpx.Response(self.status_code, json={"error": {"code": 190, "message": "Invalid OAuth access token."}})
        return httpx.Response(200, json={"id": "123456789012345", "name": "Page Démo Télécom", "category": "Télécom"})


@pytest.fixture
def configured(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode("ascii"))
    monkeypatch.setattr(settings, "fb_page_access_token", TOKEN)
    monkeypatch.setattr(settings, "fb_default_page_id", "123456789012345")
    monkeypatch.setattr(settings, "bootstrap_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "sync_interval_minutes", 0)
    monkeypatch.setattr(settings, "token_check_interval_hours", 0)
    store = FilePageStore(tmp_path / "state" / "pages.json")
    monkeypatch.setattr(api, "page_store", store)
    meta = FakeMeta()
    factory = lambda access_token: FacebookGraphClient(  # noqa: E731
        access_token=access_token, transport=httpx.MockTransport(meta), max_retries=1
    )
    monkeypatch.setattr(api, "facebook_client_factory", factory)
    return store, meta, factory


def test_startup_registers_default_page_with_encrypted_token(configured):
    store, meta, _ = configured
    with TestClient(app):
        pass

    pages = asyncio.run(store.list_pages(CLIENT_ID))
    assert len(pages) == 1
    page = pages[0]
    assert (page.page_id, page.page_name, page.status, page.category) == ("123456789012345", "Page Démo Télécom", "active", "Télécom")
    assert decrypt_token(page.page_token_encrypted) == TOKEN
    assert TOKEN not in store.path.read_text(encoding="utf-8")
    assert meta.calls == 1


def test_restart_updates_without_duplicate(configured):
    store, _, _ = configured
    with TestClient(app):
        pass
    first = asyncio.run(store.list_pages(CLIENT_ID))[0]
    with TestClient(app):
        pass
    pages = asyncio.run(store.list_pages())
    assert len(pages) == 1
    assert pages[0].id == first.id
    assert pages[0].connected_at == first.connected_at


def test_token_never_logged(configured, caplog):
    store, _, factory = configured
    caplog.set_level(logging.DEBUG)
    page = asyncio.run(bootstrap_default_page(store=store, client_factory=factory))
    assert page is not None
    assert caplog.records, "l'amorçage doit journaliser son résultat"
    assert all(TOKEN not in record.getMessage() for record in caplog.records)
    assert TOKEN not in caplog.text


def test_meta_refusal_logs_without_token_and_registers_nothing(configured, monkeypatch, caplog):
    store, _, _ = configured
    refusing = FakeMeta(status_code=400)
    factory = lambda access_token: FacebookGraphClient(  # noqa: E731
        access_token=access_token, transport=httpx.MockTransport(refusing), max_retries=1
    )
    caplog.set_level(logging.DEBUG)
    assert asyncio.run(bootstrap_default_page(store=store, client_factory=factory)) is None
    assert asyncio.run(store.list_pages()) == []
    assert TOKEN not in caplog.text


@pytest.mark.parametrize("missing", ["fb_page_access_token", "fb_default_page_id", "bootstrap_client_id"])
def test_nothing_happens_when_a_variable_is_missing(configured, monkeypatch, missing):
    store, meta, _ = configured
    monkeypatch.setattr(settings, missing, "")
    with TestClient(app):
        pass
    assert asyncio.run(store.list_pages()) == []
    assert meta.calls == 0
    assert not store.path.exists()

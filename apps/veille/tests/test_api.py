import asyncio
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import pytest

import scraping_service.api as api
from scraping_service.api import app
from scraping_service.base import FeedbackItem
from scraping_service.config import settings
from scraping_service.core.crypto import decrypt_token
from scraping_service.core.feedback_store import FileFeedbackStore
from scraping_service.core.oauth_state import create_oauth_state
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "api_key", "test-api-key")
    monkeypatch.setattr(settings, "state_secret", "test-state-secret")
    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode("ascii"))
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")
    monkeypatch.setattr(settings, "state_dir", tmp_path / "state")
    monkeypatch.setattr(settings, "fb_app_id", "test-app-id")
    monkeypatch.setattr(settings, "fb_app_secret", "test-app-secret")
    monkeypatch.setattr(settings, "fb_redirect_uri", "https://api.example/connect/facebook/callback")
    monkeypatch.setattr(settings, "allowed_return_origins", ["https://client.example"])
    monkeypatch.setattr(api, "page_store", FilePageStore(tmp_path / "state" / "pages.json"))
    monkeypatch.setattr(api, "_used_oauth_nonces", set())
    return TestClient(app)


def _valid_debug_data():
    """Réponse debug_token d'un jeton de Page valide avec les trois permissions requises."""
    return {
        "type": "PAGE",
        "is_valid": True,
        "scopes": ["pages_show_list", "pages_read_engagement", "pages_read_user_content"],
        "expires_at": 0,
    }


def _oauth_graph(pages, debug_token):
    """Faux client Graph : échange OAuth réussi, Pages fournies, debug_token piloté par le test."""

    class FakeGraphClient:
        async def exchange_oauth_code(self, code):
            return {"access_token": "short-lived-test-token"}

        async def exchange_for_long_lived_token(self, token):
            return {"access_token": "long-lived-test-token"}

        async def fetch_managed_pages(self, token):
            return pages

        async def debug_token(self, token):
            return await debug_token(token)

        async def aclose(self):
            return None

    return lambda **_: FakeGraphClient()


def _callback(client, nonce="nonce-x"):
    state = create_oauth_state("client-a", "https://client.example/connect", settings.state_secret, nonce=nonce)
    return client.get(
        "/connect/facebook/callback",
        params={"state": state, "code": "test-code"},
        follow_redirects=False,
    )


def test_oauth_start_requires_key_and_checks_return_origin(client):
    payload = {"client_id": "client-a", "return_to": "https://client.example/connect"}
    assert client.post("/connect/facebook/start", json=payload).status_code == 401

    headers = {"X-API-Key": "test-api-key"}
    rejected = client.post(
        "/connect/facebook/start",
        json={**payload, "return_to": "https://evil.example/steal"},
        headers=headers,
    )
    assert rejected.status_code == 400

    response = client.post("/connect/facebook/start", json=payload, headers=headers)
    assert response.status_code == 200
    query = parse_qs(urlsplit(response.json()["authorize_url"]).query)
    assert query["response_type"] == ["code"]
    assert query["scope"] == ["pages_show_list,pages_read_engagement,pages_read_user_content"]
    assert query["redirect_uri"] == [settings.fb_redirect_uri]


def test_health_identifies_the_service(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "IKAN AI - Service de Veille"


def test_direct_facebook_scrape_reuses_existing_collector(client, monkeypatch):
    class FakeCollector:
        def __init__(self):
            self.client = self

        async def fetch(self, target, max_items):
            assert target == "https://facebook.com/example"
            assert max_items == 2
            return [FeedbackItem(source="facebook", source_id="c1", target_url=target, text="Avis")]

        async def aclose(self):
            return None

    monkeypatch.setattr(api, "FacebookCollector", FakeCollector)
    response = client.post(
        "/scrape/facebook",
        json={"target": "https://facebook.com/example", "max_items": 2},
        headers={"X-API-Key": "test-api-key"},
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["items"][0]["source_id"] == "c1"


def test_oauth_start_uses_login_config_when_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "fb_login_config_id", "login-config")
    response = client.post(
        "/connect/facebook/start",
        json={"client_id": "client-a", "return_to": "https://client.example/connect"},
        headers={"X-API-Key": "test-api-key"},
    )
    query = parse_qs(urlsplit(response.json()["authorize_url"]).query)

    assert response.status_code == 200
    assert query["config_id"] == ["login-config"]
    assert query["override_default_response_type"] == ["true"]
    assert "scope" not in query


def test_oauth_callback_encrypts_page_token_and_upserts_without_duplicates(client, monkeypatch):
    class FakeGraphClient:
        async def exchange_oauth_code(self, code):
            assert code == "test-code"
            return {"access_token": "short-lived-test-token"}

        async def exchange_for_long_lived_token(self, token):
            assert token == "short-lived-test-token"
            return {"access_token": "long-lived-test-token"}

        async def fetch_managed_pages(self, token):
            assert token == "long-lived-test-token"
            return [{"id": "page-1", "name": "Page Demo", "category": "Business", "access_token": "page-test-token"}]

        async def debug_token(self, token):
            assert token == "page-test-token"
            return _valid_debug_data()

        async def aclose(self):
            return None

    monkeypatch.setattr(api, "facebook_client_factory", lambda **_: FakeGraphClient())
    for nonce in ("nonce-one", "nonce-two"):
        state = create_oauth_state(
            "client-a",
            "https://client.example/connect",
            settings.state_secret,
            nonce=nonce,
        )
        response = client.get(
            "/connect/facebook/callback",
            params={"state": state, "code": "test-code"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert "status=success" in response.headers["location"]
        assert "page-test-token" not in response.headers["location"]

    pages = __import__("asyncio").run(api.page_store.list_pages("client-a"))
    assert len(pages) == 1
    assert pages[0].page_token_encrypted != "page-test-token"
    assert decrypt_token(pages[0].page_token_encrypted) == "page-test-token"
    assert "page-test-token" not in api.page_store.path.read_text(encoding="utf-8")


def test_oauth_callback_token_validation_failure_marks_page_reauth_required(client, monkeypatch):
    """Un jeton dont la validation échoue n'est JAMAIS enregistré comme valide (régression : il l'était)."""

    async def failing_debug_token(token):
        raise RuntimeError("debug_token indisponible")

    pages = [{"id": "page-1", "name": "Page Demo", "access_token": "page-test-token"}]
    monkeypatch.setattr(api, "facebook_client_factory", _oauth_graph(pages, failing_debug_token))

    response = _callback(client)

    assert response.status_code == 302
    location = response.headers["location"]
    assert "status=error" in location
    assert "code=token_validation_failed" in location
    assert "status=success" not in location
    stored = asyncio.run(api.page_store.list_pages("client-a"))
    assert len(stored) == 1
    assert stored[0].is_valid is False
    assert stored[0].status == "reauth_required"
    assert stored[0].last_error == "token_validation_failed"
    assert stored[0].expires_at is None
    # Le jeton reste chiffré au repos, même quand il n'est pas validé.
    assert "page-test-token" not in api.page_store.path.read_text(encoding="utf-8")


def test_oauth_callback_counts_only_valid_active_pages(client, monkeypatch):
    async def debug_token(token):
        if token == "token-ok":
            return _valid_debug_data()
        if token == "token-missing-scope":
            return {**_valid_debug_data(), "scopes": ["pages_show_list"]}
        raise RuntimeError("debug_token indisponible")

    pages = [
        {"id": "page-ok", "name": "Valide", "access_token": "token-ok"},
        {"id": "page-ko", "name": "Échec de validation", "access_token": "token-ko"},
        {"id": "page-scope", "name": "Permissions manquantes", "access_token": "token-missing-scope"},
    ]
    monkeypatch.setattr(api, "facebook_client_factory", _oauth_graph(pages, debug_token))

    location = _callback(client).headers["location"]

    assert "status=success" in location
    assert "pages=1" in location
    stored = {page.page_id: page for page in asyncio.run(api.page_store.list_pages("client-a"))}
    assert stored["page-ok"].status == "active" and stored["page-ok"].is_valid is True
    assert stored["page-ko"].status == "reauth_required" and stored["page-ko"].is_valid is False
    assert stored["page-scope"].status == "error"


def test_oauth_callback_without_any_valid_page_reports_validation_failure(client, monkeypatch):
    async def debug_token(token):
        return {**_valid_debug_data(), "is_valid": False}

    pages = [{"id": "page-1", "name": "Page", "access_token": "token-expired"}]
    monkeypatch.setattr(api, "facebook_client_factory", _oauth_graph(pages, debug_token))

    location = _callback(client).headers["location"]

    assert "status=error" in location
    assert "code=token_validation_failed" in location


def test_oauth_start_derives_redirect_uri_from_render_external_url(client, monkeypatch):
    monkeypatch.setattr(settings, "fb_redirect_uri", "")
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://veille.example.test/")
    payload = {"client_id": "client-a", "return_to": "https://client.example/connect"}

    response = client.post("/connect/facebook/start", json=payload, headers={"X-API-Key": "test-api-key"})

    assert response.status_code == 200
    query = parse_qs(urlsplit(response.json()["authorize_url"]).query)
    assert query["redirect_uri"] == ["https://veille.example.test/connect/facebook/callback"]


def test_explicit_redirect_uri_wins_over_render_external_url(client, monkeypatch):
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://veille.example.test")
    assert settings.facebook_redirect_uri == "https://api.example/connect/facebook/callback"


def test_oauth_start_unavailable_without_any_redirect_uri(client, monkeypatch):
    monkeypatch.setattr(settings, "fb_redirect_uri", "")
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    payload = {"client_id": "client-a", "return_to": "https://client.example/connect"}

    response = client.post("/connect/facebook/start", json=payload, headers={"X-API-Key": "test-api-key"})

    assert response.status_code == 503


def test_code_exchange_sends_the_derived_redirect_uri(monkeypatch):
    """L'échange du code OAuth utilise la même URI que l'autorisation (sinon Meta le refuse)."""
    import httpx
    from scraping_service.facebook.client import FacebookGraphClient

    monkeypatch.setattr(settings, "fb_app_id", "test-app-id")
    monkeypatch.setattr(settings, "fb_app_secret", "test-app-secret")
    monkeypatch.setattr(settings, "fb_redirect_uri", "")
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://veille.example.test")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={"access_token": "t"})

    async def exchange():
        graph = FacebookGraphClient(access_token="", transport=httpx.MockTransport(handler))
        try:
            await graph.exchange_oauth_code("code-1")
        finally:
            await graph.aclose()

    asyncio.run(exchange())

    assert seen["redirect_uri"] == "https://veille.example.test/connect/facebook/callback"


def test_oauth_callback_denial_and_state_replay(client):
    state = create_oauth_state("client-a", "https://client.example/connect", settings.state_secret)
    denied = client.get(
        "/connect/facebook/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    replay = client.get(
        "/connect/facebook/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )

    assert "status=denied" in denied.headers["location"]
    assert replay.status_code == 400


def test_page_listing_requires_api_key_and_never_returns_encrypted_token(client):
    page = asyncio.run(
        api.page_store.upsert_page(
            ConnectedPage(
                client_id="client-a",
                page_id="page-1",
                page_name="Page Demo",
                page_token_encrypted="encrypted-test-value",
            )
        )
    )
    assert page.page_token_encrypted == "encrypted-test-value"
    assert client.get("/pages", params={"client_id": "client-a"}).status_code == 401

    response = client.get(
        "/pages",
        params={"client_id": "client-a"},
        headers={"X-API-Key": "test-api-key"},
    )
    assert response.status_code == 200
    assert "encrypted-test-value" not in response.text


def test_page_sync_is_client_isolated_and_uses_injected_graph(client, monkeypatch):
    page = asyncio.run(
        api.page_store.upsert_page(
            ConnectedPage(
                client_id="client-a",
                page_id="page-1",
                page_name="Page Demo",
                page_token_encrypted=api.encrypt_token("encrypted-test-token"),
            )
        )
    )

    class FakeGraphClient:
        async def fetch_page_posts(self, page_id, limit, since):
            return [{"id": "post-1", "message": "post"}]

        async def fetch_post_comments(self, post_id, max_comments):
            return [{"id": "comment-1", "message": "Feedback", "from": None}]

        async def aclose(self):
            return None

    monkeypatch.setattr(api, "facebook_client_factory", lambda **_: FakeGraphClient())
    headers = {"X-API-Key": "test-api-key"}

    forbidden = client.post(f"/pages/{page.id}/sync", params={"client_id": "client-b"}, headers=headers)
    assert forbidden.status_code == 404
    response = client.post(f"/pages/{page.id}/sync", params={"client_id": "client-a"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert "encrypted-test-token" not in response.text


def test_feedback_endpoint_uses_line_cursor_and_client_scope(client):
    store = FileFeedbackStore(settings.data_dir, settings.state_dir)
    for index in range(3):
        store.append_new(
            "client-a",
            f"page-{index}",
            [FeedbackItem(source="facebook", source_id=f"comment-{index}", target_url="url", text="text")],
        )
    headers = {"X-API-Key": "test-api-key"}

    first = client.get("/feedback", params={"client_id": "client-a", "limit": 2}, headers=headers)
    second = client.get(
        "/feedback",
        params={"client_id": "client-a", "limit": 2, "cursor": first.json()["next_cursor"]},
        headers=headers,
    )
    other_client = client.get("/feedback", params={"client_id": "client-b"}, headers=headers)

    assert len(first.json()["items"]) == 2
    assert first.json()["next_cursor"] == 2
    assert len(second.json()["items"]) == 1
    assert other_client.json()["items"] == []


def test_production_startup_refuses_missing_api_key(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "api_key", "")

    with pytest.raises(Exception, match="VEILLE_API_KEY"):
        with TestClient(app):
            pass

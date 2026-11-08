"""Contrat entre apps/api et le service de veille.

apps/api n'appelle que : GET /health, GET /pages, POST /connect/facebook/start,
POST /pages/{uuid}/sync et GET /feedback (voir apps/api/app/services/veille_service.py).
Ces tests figent les champs qu'il lit : retirer ou renommer l'un d'eux casse la production.
Les champs peuvent être AJOUTÉS à une réponse, jamais retirés.
"""

import ast
import asyncio
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import pytest

import scraping_service.api as api
from scraping_service.api import app
from scraping_service.base import FeedbackItem
from scraping_service.config import settings
from scraping_service.core.crypto import encrypt_token
from scraping_service.core.feedback_store import FileFeedbackStore
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage

HEADERS = {"X-API-Key": "test-api-key"}

# Réponse de GET /health : identité vérifiée par apps/api (VEILLE_SERVICE_IDENTITY).
HEALTH_FIELDS = {"status", "service", "version", "api_meta_version"}
SERVICE_IDENTITY = "IKAN AI - Service de Veille"

# Réponse de GET /pages : liste blanche d'apps/api + champs historiques exposés.
PAGE_FIELDS_READ_BY_API = {
    "id", "client_id", "page_id", "page_name", "status",
    "expires_at", "data_access_expires_at", "needs_attention", "last_sync_at",
}
PAGE_FIELDS_FROZEN = PAGE_FIELDS_READ_BY_API | {
    "category", "scopes", "token_type", "is_valid", "reauth_reason", "reason",
    "connected_at", "token_checked_at", "last_error",
}

# Réponse de POST /pages/{uuid}/sync : apps/api lit « status » et « count ».
SYNC_FIELDS_FROZEN = {"page_id", "status", "partial", "errors", "count"}

# Éléments de GET /feedback (FeedbackItem sérialisé) : apps/api lit text, source_id,
# target_url, permalink, published_at, source ; le reste est conservé tel quel.
FEEDBACK_FIELDS_READ_BY_API = {"text", "source", "source_id", "target_url", "permalink", "published_at"}
FEEDBACK_FIELDS_FROZEN = FEEDBACK_FIELDS_READ_BY_API | {
    "author_name", "author_hash", "rating", "raw_text", "sentiment", "theme",
    "confidence", "ai_analyzed_at", "metadata",
}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "api_key", "test-api-key")
    monkeypatch.setattr(settings, "state_secret", "test-state-secret")
    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode("ascii"))
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")
    monkeypatch.setattr(settings, "state_dir", tmp_path / "state")
    monkeypatch.setattr(settings, "fb_app_id", "test-app-id")
    monkeypatch.setattr(settings, "fb_redirect_uri", "https://api.example/connect/facebook/callback")
    monkeypatch.setattr(settings, "allowed_return_origins", ["https://client.example"])
    monkeypatch.setattr(api, "page_store", FilePageStore(tmp_path / "state" / "pages.json"))
    monkeypatch.setattr(api, "_used_oauth_nonces", set())
    return TestClient(app)


def _seed_page(client_id="client-a", page_id="page-1"):
    return asyncio.run(
        api.page_store.upsert_page(
            ConnectedPage(
                client_id=client_id,
                page_id=page_id,
                page_name="Page Demo",
                page_token_encrypted=encrypt_token("token-de-test"),
            )
        )
    )


def test_health_contract_without_api_key(client):
    """apps/api appelle /health sans clé et exige l'identité exacte du service."""
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert HEALTH_FIELDS <= set(body)
    assert body["status"] == "ok"
    assert body["service"] == SERVICE_IDENTITY


def test_pages_contract(client):
    _seed_page()

    response = client.get("/pages", params={"client_id": "client-a"}, headers=HEADERS)

    assert response.status_code == 200
    pages = response.json()["pages"]
    assert len(pages) == 1
    assert PAGE_FIELDS_FROZEN <= set(pages[0])
    assert pages[0]["client_id"] == "client-a"
    assert pages[0]["status"] == "active"
    assert pages[0]["id"] and isinstance(pages[0]["needs_attention"], bool)


def test_pages_contract_covers_the_whitelist_declared_in_apps_api(client):
    """Lit la liste blanche réellement déclarée dans apps/api : tout champ qu'elle attend doit exister ici."""
    source = Path(__file__).resolve().parents[2] / "api" / "app" / "services" / "veille_service.py"
    if not source.exists():
        pytest.skip("apps/api absent de cette arborescence")
    declared = None
    for node in ast.parse(source.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_CHAMPS_PAGE_EXPOSES" for t in node.targets):
            declared = set(ast.literal_eval(node.value))
    assert declared, "_CHAMPS_PAGE_EXPOSES introuvable dans apps/api"
    _seed_page()

    page = client.get("/pages", params={"client_id": "client-a"}, headers=HEADERS).json()["pages"][0]

    assert declared <= set(page)
    # apps/api filtre aussi sur client_id.
    assert "client_id" in page


def test_connect_start_contract(client):
    payload = {"client_id": "client-a", "return_to": "https://client.example/connect"}

    response = client.post("/connect/facebook/start", json=payload, headers=HEADERS)

    assert response.status_code == 200
    authorize_url = response.json()["authorize_url"]
    parsed = urlsplit(authorize_url)
    assert parsed.scheme == "https"
    assert parsed.hostname == "www.facebook.com"


def test_page_sync_contract(client, monkeypatch):
    page = _seed_page()

    class FakeGraphClient:
        async def fetch_page_posts(self, page_id, limit, since):
            return [{"id": "post-1", "message": "post"}]

        async def fetch_post_comments(self, post_id, max_comments):
            return [{"id": "comment-1", "message": "Avis", "from": None}]

        async def aclose(self):
            return None

    monkeypatch.setattr(api, "facebook_client_factory", lambda **_: FakeGraphClient())

    response = client.post(f"/pages/{page.id}/sync", params={"client_id": "client-a"}, headers=HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert SYNC_FIELDS_FROZEN <= set(body)
    assert body["status"] == "success"
    assert body["count"] == 1


def test_feedback_contract(client):
    store = FileFeedbackStore(settings.data_dir, settings.state_dir)
    store.append_new(
        "client-a",
        "page-1",
        [
            FeedbackItem(
                source="facebook",
                source_id="comment-1",
                target_url="https://www.facebook.com/page-1",
                text="Un avis",
                permalink="https://www.facebook.com/page-1/posts/1?comment_id=2",
            )
        ],
    )

    response = client.get("/feedback", params={"client_id": "client-a", "limit": 200, "cursor": 0}, headers=HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert set(body) >= {"items", "next_cursor"}
    assert body["next_cursor"] is None
    assert FEEDBACK_FIELDS_FROZEN <= set(body["items"][0])
    assert body["items"][0]["text"] == "Un avis"
    assert body["items"][0]["source_id"] == "comment-1"
    assert body["items"][0]["target_url"] == "https://www.facebook.com/page-1"

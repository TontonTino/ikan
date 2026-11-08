"""Isolation par client_id et absence de fuite de jetons dans le service de veille."""

import asyncio
import logging
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
from scraping_service.core.oauth_state import create_oauth_state
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage

HEADERS = {"X-API-Key": "test-api-key"}
TOKEN_A = "EAAJETON-CLIENT-A-0001"
TOKEN_B = "EAAJETON-CLIENT-B-0002"


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


@pytest.fixture
def two_clients(client):
    """Deux clients, une Page chacun, un avis chacun ; le même page_id chez les deux (cas piège)."""
    pages = {}
    for client_id, token, text in (("client-a", TOKEN_A, "AVIS-SECRET-DU-CLIENT-A"), ("client-b", TOKEN_B, "AVIS-SECRET-DU-CLIENT-B")):
        pages[client_id] = asyncio.run(
            api.page_store.upsert_page(
                ConnectedPage(
                    client_id=client_id,
                    page_id="page-commune" if client_id == "client-a" else "page-commune",
                    page_name=f"Page de {client_id}",
                    page_token_encrypted=encrypt_token(token),
                )
            )
        )
        FileFeedbackStore(settings.data_dir, settings.state_dir).append_new(
            client_id,
            "page-commune",
            [FeedbackItem(source="facebook", source_id=f"c-{client_id}", target_url="url", text=text)],
        )
    return pages


# ── Isolation ───────────────────────────────────────────────────────────────


def test_pages_and_feedback_are_scoped_to_the_requested_client(client, two_clients):
    pages_a = client.get("/pages", params={"client_id": "client-a"}, headers=HEADERS).json()["pages"]
    feedback_a = client.get("/feedback", params={"client_id": "client-a"}, headers=HEADERS).json()["items"]
    pages_b = client.get("/pages", params={"client_id": "client-b"}, headers=HEADERS).json()["pages"]
    feedback_b = client.get("/feedback", params={"client_id": "client-b"}, headers=HEADERS).json()["items"]

    assert [p["client_id"] for p in pages_a] == ["client-a"]
    assert [p["page_name"] for p in pages_a] == ["Page de client-a"]
    assert [i["text"] for i in feedback_a] == ["AVIS-SECRET-DU-CLIENT-A"]
    assert [p["client_id"] for p in pages_b] == ["client-b"]
    assert [i["text"] for i in feedback_b] == ["AVIS-SECRET-DU-CLIENT-B"]


@pytest.mark.parametrize(
    "forged",
    [
        "client-a/../client-b",
        "../client-b",
        "..",
        "client-b ",
        " client-b",
        "CLIENT-B",
        "client-b\n",
        "client-b%00",
        "client-b,client-a",
        "client-b;client-a",
        "client-b' OR '1'='1",
        "*",
        "%",
        "",
    ],
)
def test_forged_client_id_never_exposes_another_client(client, two_clients, forged):
    """Un identifiant manipulé est refusé (400) ou ne donne rien : jamais les données d'un autre client."""
    for route in ("/pages", "/feedback"):
        response = client.get(route, params={"client_id": forged}, headers=HEADERS)
        # Seuls client-a / client-b existent : une valeur falsifiée ne doit révéler ni l'un ni l'autre.
        assert "AVIS-SECRET-DU-CLIENT" not in response.text, (route, forged)
        assert "Page de client-" not in response.text, (route, forged)
        assert response.status_code in {200, 400, 422}, (route, forged)


def test_forged_client_id_in_the_body_and_the_query_are_not_mixed(client, two_clients):
    """Le client_id de la requête est le seul qui compte : un second paramètre ne l'écrase pas."""
    response = client.get("/feedback?client_id=client-a&client_id=client-b", headers=HEADERS)

    assert response.status_code == 200
    texts = [item["text"] for item in response.json()["items"]]
    assert texts in (["AVIS-SECRET-DU-CLIENT-A"], ["AVIS-SECRET-DU-CLIENT-B"])  # un seul client, jamais les deux


def test_actions_on_another_clients_page_are_refused_and_change_nothing(client, two_clients, monkeypatch):
    page_b = two_clients["client-b"]
    monkeypatch.setattr(api, "facebook_client_factory", lambda **_: pytest.fail("aucun appel Meta attendu"))

    sync = client.post(f"/pages/{page_b.id}/sync", params={"client_id": "client-a"}, headers=HEADERS)
    reconnect = client.get(
        f"/pages/{page_b.id}/reconnect-url",
        params={"client_id": "client-a", "return_to": "https://client.example/connect"},
        headers=HEADERS,
    )
    delete = client.delete(f"/pages/{page_b.id}", params={"client_id": "client-a", "purge": "true"}, headers=HEADERS)

    assert (sync.status_code, reconnect.status_code, delete.status_code) == (404, 404, 404)
    still_there = asyncio.run(api.page_store.get_page(page_b.id))
    assert still_there.status == "active"
    feedback_b = client.get("/feedback", params={"client_id": "client-b"}, headers=HEADERS).json()["items"]
    assert [item["text"] for item in feedback_b] == ["AVIS-SECRET-DU-CLIENT-B"]


def test_feedback_cursor_cannot_reach_another_clients_records(client, two_clients):
    for cursor in (1, 2, 100):
        response = client.get("/feedback", params={"client_id": "client-a", "cursor": cursor}, headers=HEADERS)
        assert "AVIS-SECRET-DU-CLIENT-B" not in response.text


def test_ai_analyze_is_scoped_to_the_requested_client(client, two_clients):
    response = client.post("/ai/analyze", json={"client_id": "client-a"}, headers=HEADERS)

    assert response.status_code == 200
    assert [item["text"] for item in response.json()["items"]] == ["AVIS-SECRET-DU-CLIENT-A"]


def test_sync_all_stores_feedback_under_the_owning_client(client, tmp_path, monkeypatch):
    """Même page_id chez deux clients : chaque synchronisation écrit dans le dossier de SON client."""
    from scraping_service.services.sync import sync_all

    for client_id, token in (("client-a", TOKEN_A), ("client-b", TOKEN_B)):
        asyncio.run(
            api.page_store.upsert_page(
                ConnectedPage(
                    client_id=client_id, page_id="page-commune", page_name=client_id,
                    page_token_encrypted=encrypt_token(token),
                )
            )
        )

    class FakeGraph:
        def __init__(self, access_token=None):
            self.access_token = access_token

        async def fetch_page_posts(self, page_id, limit, since):
            return [{"id": "post-1", "message": "m"}]

        async def fetch_post_comments(self, post_id, max_comments):
            return [{"id": f"commentaire-{self.access_token}", "message": f"avis via {self.access_token}", "from": None}]

        async def aclose(self):
            return None

    asyncio.run(sync_all(store=api.page_store, feedback_store=FileFeedbackStore(), client_factory=FakeGraph))

    store = FileFeedbackStore()
    assert [r["text"] for r in store.list_items("client-a")] == [f"avis via {TOKEN_A}"]
    assert [r["text"] for r in store.list_items("client-b")] == [f"avis via {TOKEN_B}"]


# ── Jetons : jamais dans une réponse destinée au navigateur, jamais dans les journaux ─────────────


FORBIDDEN_KEYS = {"page_token_encrypted", "page_token", "access_token", "user_token", "client_secret", "app_secret"}


def _walk(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def test_no_token_in_any_response(client, two_clients, monkeypatch):
    page_a = two_clients["client-a"]
    ciphertext = page_a.page_token_encrypted

    class FakeGraphClient:
        async def fetch_page_posts(self, page_id, limit, since):
            return []

        async def aclose(self):
            return None

    monkeypatch.setattr(api, "facebook_client_factory", lambda **_: FakeGraphClient())
    responses = [
        client.get("/health"),
        client.get("/health", params={"deep": "true"}, headers=HEADERS),
        client.get("/pages", params={"client_id": "client-a"}, headers=HEADERS),
        client.get("/feedback", params={"client_id": "client-a"}, headers=HEADERS),
        client.post(f"/pages/{page_a.id}/sync", params={"client_id": "client-a"}, headers=HEADERS),
        client.post("/ai/analyze", json={"client_id": "client-a"}, headers=HEADERS),
        client.get(
            f"/pages/{page_a.id}/reconnect-url",
            params={"client_id": "client-a", "return_to": "https://client.example/connect"},
            headers=HEADERS,
        ),
        client.post(
            "/connect/facebook/start",
            json={"client_id": "client-a", "return_to": "https://client.example/connect"},
            headers=HEADERS,
        ),
        client.get("/pages", params={"client_id": "client-a"}),  # sans clé : 401
        client.post(f"/pages/{page_a.id}/sync", params={"client_id": "client-b"}, headers=HEADERS),  # 404
    ]

    for response in responses:
        assert TOKEN_A not in response.text and TOKEN_B not in response.text, response.request.url
        assert ciphertext not in response.text, response.request.url
        if "json" in response.headers.get("content-type", ""):
            assert not (set(_walk(response.json())) & FORBIDDEN_KEYS), response.request.url
        for header_value in response.headers.values():
            assert TOKEN_A not in header_value and ciphertext not in header_value

    # Le dernier appel (suppression) retire la Page sans jamais renvoyer le jeton.
    deleted = client.delete(f"/pages/{page_a.id}", params={"client_id": "client-a"}, headers=HEADERS)
    assert deleted.status_code == 200 and TOKEN_A not in deleted.text and ciphertext not in deleted.text


def test_uvicorn_access_line_masks_the_oauth_code():
    """La ligne d'accès d'uvicorn contient l'URL du callback (?state=...&code=...) : le code est masqué."""
    from scraping_service.core import logging as veille_logging  # noqa: F401  (installe les filtres)

    captured: list[str] = []

    class Capture(logging.Handler):
        def emit(self, record):
            captured.append(record.getMessage())

    access_logger = logging.getLogger("uvicorn.access")
    handler = Capture()
    access_logger.addHandler(handler)
    try:
        access_logger.setLevel(logging.INFO)
        access_logger.info(
            '%s - "%s %s HTTP/%s" %d',
            "127.0.0.1:5000",
            "GET",
            "/connect/facebook/callback?state=abc&code=CODE-OAUTH-SECRET",
            "1.1",
            302,
        )
    finally:
        access_logger.removeHandler(handler)

    assert captured and "CODE-OAUTH-SECRET" not in captured[0]
    assert "code=[REDACTED]" in captured[0]
    assert "302" in captured[0]


def test_no_token_in_callback_redirect_or_logs(client, caplog, capsys, monkeypatch):
    """Le callback ne met aucun jeton dans la redirection, et les erreurs Meta (qui citent
    parfois l'URL appelée) sont masquées avant d'arriver aux journaux."""
    leaky_message = (
        "GET https://graph.facebook.com/debug_token?input_token=EAAJETON-FUITE-INPUT"
        "&access_token=APPID|APPSECRET-FUITE&client_secret=SECRET-FUITE&code=CODE-FUITE échec"
    )

    class FakeGraphClient:
        async def exchange_oauth_code(self, code):
            return {"access_token": "EAAJETON-USER-COURT"}

        async def exchange_for_long_lived_token(self, token):
            return {"access_token": "EAAJETON-USER-LONG"}

        async def fetch_managed_pages(self, token):
            return [{"id": "page-1", "name": "Page", "access_token": TOKEN_A}]

        async def debug_token(self, token):
            raise RuntimeError(leaky_message)

        async def aclose(self):
            return None

    monkeypatch.setattr(api, "facebook_client_factory", lambda **_: FakeGraphClient())
    state = create_oauth_state("client-a", "https://client.example/connect", settings.state_secret)
    caplog.set_level(logging.DEBUG)

    response = client.get(
        "/connect/facebook/callback", params={"state": state, "code": "CODE-FUITE"}, follow_redirects=False
    )

    assert response.status_code == 302
    assert urlsplit(response.headers["location"]).netloc == "client.example"
    # On exclut les journaux du client de test lui-même (« httpx » côté TestClient) : seuls ceux
    # du service comptent ici. La ligne d'accès uvicorn est couverte par un test dédié ci-dessous.
    service_logs = "\n".join(r.getMessage() for r in caplog.records if not r.name.startswith("httpx"))
    everything = response.headers["location"] + service_logs + capsys.readouterr().out
    for secret in ("EAAJETON", "APPSECRET-FUITE", "SECRET-FUITE", "CODE-FUITE", TOKEN_A):
        assert secret not in everything, secret
    assert "token_validation_failed" in response.headers["location"]
    # La trace de l'échec existe bien (on a masqué, pas supprimé).
    assert "Échec de validation du jeton pour la page page-1" in service_logs
    # Au repos, le fichier des Pages ne contient que le jeton chiffré.
    assert TOKEN_A not in api.page_store.path.read_text(encoding="utf-8")

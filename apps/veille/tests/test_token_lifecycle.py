import asyncio
from datetime import datetime, timezone
import io
import logging
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import httpx
import pytest

import scraping_service.api as api
from scraping_service.api import app
from scraping_service.config import settings
from scraping_service.core.crypto import decrypt_token, encrypt_token
from scraping_service.core.exceptions import (
    PermissionDeniedError,
    TargetValidationError,
    TokenExpiredError,
)
from scraping_service.core.logging import TokenMaskingFilter, apply_token_masking
from scraping_service.core.oauth_state import create_oauth_state
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage, calculate_page_attention
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.tokens import inspect_and_validate_page_token
from scraping_service.services.alert import send_page_attention_alert
from scraping_service.services.token_lifecycle import check_all_pages_tokens
from scripts.exchange_dev_token import exchange_and_store_dev_token
from scripts.rotate_encryption_key import rotate_keys


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def test_setup(tmp_path, monkeypatch):
    key1 = Fernet.generate_key().decode("ascii")
    key2 = Fernet.generate_key().decode("ascii")
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "api_key", "test-api-key")
    monkeypatch.setattr(settings, "state_secret", "test-secret-salt")
    monkeypatch.setattr(settings, "token_encryption_key", f"{key1},{key2}")
    monkeypatch.setattr(settings, "fb_app_id", "123456789")
    monkeypatch.setattr(settings, "fb_app_secret", "app-secret-test")
    monkeypatch.setattr(settings, "fb_redirect_uri", "https://api.example/connect/facebook/callback")
    monkeypatch.setattr(settings, "allowed_return_origins", ["https://client.example"])
    store = FilePageStore(tmp_path / "state" / "pages.json")
    monkeypatch.setattr(api, "page_store", store)
    monkeypatch.setattr(api, "_used_oauth_nonces", set())
    return {
        "store": store,
        "key1": key1,
        "key2": key2,
        "client": TestClient(app),
    }


def test_user_token_type_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "fb_app_id", "test-app-id")
    monkeypatch.setattr(settings, "fb_app_secret", "test-app-secret")

    async def handler(request):
        return httpx.Response(
            200,
            json={
                "data": {
                    "type": "USER",
                    "is_valid": True,
                    "scopes": ["pages_show_list", "pages_read_engagement", "pages_read_user_content"],
                }
            },
        )

    graph = FacebookGraphClient(access_token="test", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(TargetValidationError, match="jeton utilisateur"):
            run(inspect_and_validate_page_token("dummy-user-token", client=graph))
    finally:
        run(graph.aclose())


def test_expires_at_zero_with_data_access_expires_at_soon_triggers_needs_attention():
    now_ts = datetime.now(timezone.utc).timestamp()
    page = ConnectedPage(
        client_id="client-a",
        page_id="page-123",
        page_name="Page Attention Test",
        page_token_encrypted="dummy",
        status="active",
        expires_at=0,
        data_access_expires_at=int(now_ts + 3 * 86400),  # 3 days left (< 14 days)
    )
    needs_attention, reason = calculate_page_attention(page, now_ts=now_ts, token_warn_days=7, data_access_warn_days=14)
    assert needs_attention is True
    assert "données expire dans 3 jour(s)" in (reason or "")


def test_subcode_error_mappings_and_page_statuses(test_setup):
    store = test_setup["store"]
    cases = [
        (463, "reauth_required", "Session ou jeton expiré"),
        (467, "reauth_required", "Session ou jeton expiré"),
        (460, "reauth_required", "Mot de passe changé ou session fermée"),
        (492, "reauth_required", "L'utilisateur n'a plus de rôle sur la Page"),
        (458, "revoked", "Application retirée par l'utilisateur"),
        (999, "reauth_required", "Erreur d'authentification (999)"),
    ]

    for subcode, expected_status, expected_reason in cases:
        page = ConnectedPage(
            client_id="client-test",
            page_id=f"page-{subcode}",
            page_name=f"Page {subcode}",
            page_token_encrypted=encrypt_token("token-val"),
            status="active",
        )
        run(store.upsert_page(page))

        async def handler(request, code=subcode):
            return httpx.Response(
                400,
                json={"error": {"code": 190, "error_subcode": code, "type": "OAuthException", "message": "error"}},
            )

        class CustomClient(FacebookGraphClient):
            def __init__(self, **kwargs):
                super().__init__(transport=httpx.MockTransport(handler), **kwargs)

        run(check_all_pages_tokens(store=store, client_factory=CustomClient))
        updated = run(store.get_page(page.id))
        assert updated is not None
        assert updated.status == expected_status
        assert updated.reauth_reason == expected_reason


def test_reconnection_upserts_same_page_resets_active(test_setup):
    store = test_setup["store"]
    client = test_setup["client"]

    initial_page = ConnectedPage(
        client_id="client-a",
        page_id="page-recon-1",
        page_name="Page To Reconnect",
        page_token_encrypted=encrypt_token("old-token"),
        status="reauth_required",
        last_error="token_expired",
        reauth_reason="Session expirée",
    )
    run(store.upsert_page(initial_page))

    class FakeGraphClient:
        async def exchange_oauth_code(self, code):
            return {"access_token": "user-short-token"}

        async def exchange_for_long_lived_token(self, token):
            return {"access_token": "user-long-token"}

        async def fetch_managed_pages(self, token):
            return [{"id": "page-recon-1", "name": "Page Reconnected", "access_token": "new-page-token"}]

        async def debug_token(self, token):
            return {
                "type": "PAGE",
                "is_valid": True,
                "expires_at": 0,
                "scopes": ["pages_show_list", "pages_read_engagement", "pages_read_user_content"],
            }

        async def aclose(self):
            return None

    with patch.object(api, "facebook_client_factory", lambda **_: FakeGraphClient()):
        state = create_oauth_state("client-a", "https://client.example/connect", settings.state_secret)
        response = client.get(
            "/connect/facebook/callback",
            params={"state": state, "code": "valid-code"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert "status=success" in response.headers["location"]

    pages = run(store.list_pages("client-a"))
    assert len(pages) == 1
    reconnected = pages[0]
    assert reconnected.id == initial_page.id
    assert reconnected.status == "active"
    assert reconnected.last_error is None
    assert reconnected.reauth_reason is None
    assert decrypt_token(reconnected.page_token_encrypted) == "new-page-token"


def test_alert_webhook_is_sent_only_once_per_state_change(monkeypatch, tmp_path):
    store = FilePageStore(tmp_path / "pages.json")
    webhook_calls = []

    async def handler(request):
        webhook_calls.append(request)
        return httpx.Response(200, json={"status": "received"})

    monkeypatch.setattr(settings, "alert_webhook_url", "https://alert.example/webhook")
    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode("ascii"))
    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    page = ConnectedPage(
        client_id="client-a",
        page_id="page-alert-1",
        page_name="Alert Page",
        page_token_encrypted=encrypt_token("tok"),
        status="reauth_required",
        reauth_reason="Session expirée",
    )
    run(store.upsert_page(page))

    # Premier envoi : webhook appelé
    sent1 = run(send_page_attention_alert(page, "Session expirée", store=store, client=http_client))
    assert sent1 is True
    assert len(webhook_calls) == 1

    # Récupérer la page mise à jour avec last_alerted_state
    updated_page = run(store.get_page(page.id))

    # Deuxième appel avec le même état : non envoyé
    sent2 = run(send_page_attention_alert(updated_page, "Session expirée", store=store, client=http_client))
    assert sent2 is False
    assert len(webhook_calls) == 1

    # Nouvel état (ex: révoqué) : envoyé
    updated_page = updated_page.model_copy(update={"status": "revoked", "reauth_reason": "App retirée"})
    sent3 = run(send_page_attention_alert(updated_page, "App retirée", store=store, client=http_client))
    assert sent3 is True
    assert len(webhook_calls) == 2

    # Vérification qu'aucun token n'est présent dans le payload
    payload = webhook_calls[0].read().decode("utf-8")
    assert "token" not in payload.lower()
    assert "tok" not in payload
    assert "event" in payload


def test_dev_token_exchange_does_not_leak_token_in_stdout(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode("ascii"))
    store = FilePageStore(tmp_path / "pages.json")

    class FakeGraph:
        async def debug_token(self, token):
            return {
                "type": "PAGE",
                "is_valid": True,
                "expires_at": 0,
                "scopes": ["pages_show_list", "pages_read_engagement", "pages_read_user_content"],
            }

        async def get_page_info(self, page_id):
            return {"id": "dev-page-999", "name": "Dev Page Test", "category": "Community"}

        async def exchange_for_long_lived_token(self, token):
            return {"access_token": token}

        async def aclose(self):
            return None

    test_token = "EAAB12345SECRETDEVTOKEN"
    saved = run(exchange_and_store_dev_token(test_token, store=store, graph_client=FakeGraph()))

    assert saved.page_name == "Dev Page Test"
    assert saved.page_id == "dev-page-999"

    # Vérification que le fichier ne contient pas le token en clair
    file_content = store.path.read_text(encoding="utf-8")
    assert test_token not in file_content

    # Vérification de la sortie console via main()
    with patch("getpass.getpass", return_value=test_token):
        with patch("scripts.exchange_dev_token.FacebookGraphClient", return_value=FakeGraph()):
            from scripts.exchange_dev_token import main
            main([])

    captured = capsys.readouterr().out
    assert test_token not in captured
    assert "Dev Page Test" in captured


def test_key_rotation_keeps_tokens_decryptable(tmp_path, monkeypatch):
    key1 = Fernet.generate_key().decode("ascii")
    key2 = Fernet.generate_key().decode("ascii")
    store = FilePageStore(tmp_path / "pages.json")

    # On chiffre d'abord avec la 2ème clé
    monkeypatch.setattr(settings, "token_encryption_key", f"{key2}")
    old_encrypted = encrypt_token("secret-page-token-val")

    page = ConnectedPage(
        client_id="client-rot",
        page_id="page-rot-1",
        page_name="Page Rotation",
        page_token_encrypted=old_encrypted,
        status="active",
    )
    run(store.upsert_page(page))

    # On configure les deux clés : key1 (primaire) et key2 (ancienne)
    monkeypatch.setattr(settings, "token_encryption_key", f"{key1},{key2}")

    # Exécution de la rotation
    count = run(rotate_keys(store))
    assert count == 1

    updated_page = run(store.get_page(page.id))
    assert updated_page.page_token_encrypted != old_encrypted
    # On vérifie que le token déchiffré est identique
    assert decrypt_token(updated_page.page_token_encrypted) == "secret-page-token-val"

    # Et avec seulement key1 (la nouvelle clé primaire), le déchiffrement réussit
    monkeypatch.setattr(settings, "token_encryption_key", key1)
    assert decrypt_token(updated_page.page_token_encrypted) == "secret-page-token-val"


def test_token_masking_filter_masks_patterns():
    filtr = TokenMaskingFilter()
    record = logging.LogRecord(
        name="test_logger",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Calling Graph API with access_token=EAAB12345xyz and Bearer EAAC6789abc or EAA99999",
        args=None,
        exc_info=None,
    )
    filtr.filter(record)
    assert "access_token=[REDACTED]" in record.msg
    assert "Bearer [REDACTED]" in record.msg
    assert "[META_TOKEN_REDACTED]" in record.msg
    assert "EAAB12345xyz" not in record.msg
    assert "EAAC6789abc" not in record.msg
    assert "EAA99999" not in record.msg


def test_reconnect_url_endpoint(test_setup):
    client = test_setup["client"]
    store = test_setup["store"]

    page = ConnectedPage(
        client_id="client-a",
        page_id="page-reconn-1",
        page_name="Page Reconn",
        page_token_encrypted="enc",
        status="reauth_required",
    )
    run(store.upsert_page(page))

    headers = {"X-API-Key": "test-api-key"}

    # Mauvaise origine de return_to
    bad_origin = client.get(
        f"/pages/{page.id}/reconnect-url",
        params={"client_id": "client-a", "return_to": "https://malicious.example"},
        headers=headers,
    )
    assert bad_origin.status_code == 400

    # Page introuvable
    not_found = client.get(
        f"/pages/{Fernet.generate_key().decode('ascii')[:10]}/reconnect-url",
        params={"client_id": "client-a", "return_to": "https://client.example/dashboard"},
        headers=headers,
    )
    assert not_found.status_code == 404

    # Succès
    ok_resp = client.get(
        f"/pages/{page.id}/reconnect-url",
        params={"client_id": "client-a", "return_to": "https://client.example/dashboard"},
        headers=headers,
    )
    assert ok_resp.status_code == 200
    auth_url = ok_resp.json()["authorize_url"]
    assert "dialog/oauth" in auth_url
    assert "client_id=" in auth_url

"""Création et validation des états OAuth Facebook signés."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import MutableSet
from typing import Any


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_oauth_state(
    client_id: str,
    return_to: str,
    secret: str,
    *,
    now: int | None = None,
    nonce: str | None = None,
) -> str:
    """Signe les données anti-CSRF sans stockage serveur préalable."""
    issued_at = int(time.time()) if now is None else now
    payload = {
        "client_id": client_id,
        "return_to": return_to,
        "nonce": nonce or secrets.token_urlsafe(32),
        "expires_at": issued_at + 600,
    }
    encoded = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64encode(signature)}"


def consume_oauth_state(
    state: str,
    secret: str,
    used_nonces: MutableSet[str],
    *,
    now: int | None = None,
) -> dict[str, Any]:
    """Vérifie la signature, l'expiration et l'usage unique du state."""
    try:
        encoded, supplied_signature = state.split(".", 1)
        expected_signature = _b64encode(
            hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError
        payload = json.loads(_b64decode(encoded))
        current_time = int(time.time()) if now is None else now
        nonce = payload["nonce"]
        if not isinstance(nonce, str) or payload["expires_at"] <= current_time or nonce in used_nonces:
            raise ValueError
        if not isinstance(payload.get("client_id"), str) or not isinstance(payload.get("return_to"), str):
            raise ValueError
        used_nonces.add(nonce)
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("L'état OAuth est invalide ou expiré.") from exc
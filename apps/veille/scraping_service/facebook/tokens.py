"""Vérification non exposante et inspection de cycle de vie des jetons Meta."""

from datetime import datetime, timezone
from typing import Any

import httpx

from scraping_service.config import settings
from scraping_service.core.exceptions import (
    FacebookAPIError,
    TargetValidationError,
    TokenExpiredError,
)
from scraping_service.facebook.client import REQUIRED_PAGE_SCOPES, FacebookGraphClient


async def inspect_and_validate_page_token(
    page_token: str,
    client: FacebookGraphClient | None = None,
) -> dict[str, Any]:
    """Inspecte un jeton de Page via debug_token, valide son type et ses permissions."""
    graph = client or FacebookGraphClient(access_token="")
    own_graph = client is None
    try:
        data = await graph.debug_token(page_token)
        token_type = str(data.get("type", "")).upper()
        if token_type == "USER":
            raise TargetValidationError("Le jeton fourni est un jeton utilisateur et non un jeton de Page.")
        if token_type and token_type != "PAGE":
            raise TargetValidationError(f"Type de jeton invalide : {token_type} (attendu: PAGE).")

        is_valid = bool(data.get("is_valid", True))
        scopes = data.get("scopes", [])
        if not isinstance(scopes, list):
            scopes = []

        expires_at = data.get("expires_at")
        if expires_at is not None:
            try:
                expires_at = int(expires_at)
            except (ValueError, TypeError):
                expires_at = None

        data_access_expires_at = data.get("data_access_expires_at")
        if data_access_expires_at is not None:
            try:
                data_access_expires_at = int(data_access_expires_at)
                if data_access_expires_at == 0:
                    data_access_expires_at = None
            except (ValueError, TypeError):
                data_access_expires_at = None

        missing_scopes = [s for s in REQUIRED_PAGE_SCOPES if s not in scopes]
        page_status = "active"
        last_error = None
        if not is_valid:
            page_status = "reauth_required"
            last_error = "Jeton invalide"
        elif missing_scopes:
            page_status = "error"
            last_error = f"Permissions manquantes : {', '.join(missing_scopes)}"

        return {
            "token_type": token_type or "PAGE",
            "is_valid": is_valid,
            "expires_at": expires_at,
            "data_access_expires_at": data_access_expires_at,
            "scopes": scopes,
            "status": page_status,
            "last_error": last_error,
            "token_checked_at": datetime.now(timezone.utc),
        }
    finally:
        if own_graph:
            await graph.aclose()


async def inspect_token(
    access_token: str | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """Vérifie un token sans jamais inclure sa valeur dans le résultat ou les logs."""
    token = access_token or settings.fb_page_access_token
    if not token:
        return {"valid": False, "message": "Aucun token à vérifier."}
    if access_token is None and settings.env != "dev":
        return {"valid": False, "message": "Le token global n'est utilisable que par la CLI en dev."}

    graph = FacebookGraphClient(access_token=token, transport=transport)
    try:
        result = await graph.get_page_info("me")
        return {
            "valid": True,
            "id": result.get("id"),
            "name": result.get("name"),
            "message": "Token valide.",
        }
    except TokenExpiredError:
        return {"valid": False, "message": "Le token est expiré ou invalide."}
    except FacebookAPIError:
        return {"valid": False, "message": "La vérification Meta a échoué."}
    finally:
        await graph.aclose()
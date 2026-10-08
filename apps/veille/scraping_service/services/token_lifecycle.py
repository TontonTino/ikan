from typing import Any

from scraping_service.config import settings
from scraping_service.core.crypto import decrypt_token
from scraping_service.core.exceptions import (
    FacebookAPIError,
    PermissionDeniedError,
    TargetValidationError,
    TokenExpiredError,
)
from scraping_service.core.logging import logger
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import PageStore, calculate_page_attention
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.tokens import inspect_and_validate_page_token
from scraping_service.services.alert import send_page_attention_alert


async def check_all_pages_tokens(
    store: PageStore | None = None,
    client_factory: Any = None,
) -> dict[str, int]:
    """Vérifie tous les jetons de Pages actives via debug_token sans les exposer."""
    page_store = store or FilePageStore()
    factory = client_factory or FacebookGraphClient
    pages = await page_store.list_pages()
    stats = {"checked": 0, "active": 0, "reauth_required": 0, "revoked": 0, "error": 0, "needs_attention": 0}

    for page in pages:
        if page.status == "revoked":
            continue
        stats["checked"] += 1
        if not page.page_token_encrypted:
            continue
        try:
            token = decrypt_token(page.page_token_encrypted)
        except Exception:
            saved = await page_store.set_status(
                str(page.id),
                "error",
                error="Erreur de déchiffrement du jeton",
                reauth_reason="Clé de déchiffrement invalide",
            )
            stats["error"] += 1
            if saved:
                await send_page_attention_alert(saved, "Clé de déchiffrement invalide", store=page_store)
            continue

        graph = factory(access_token="")
        try:
            info = await inspect_and_validate_page_token(token, client=graph)
            updated_page = page.model_copy(
                update={
                    "token_type": info["token_type"],
                    "is_valid": info["is_valid"],
                    "expires_at": info["expires_at"],
                    "data_access_expires_at": info["data_access_expires_at"],
                    "scopes": info["scopes"],
                    "status": info["status"],
                    "last_error": info["last_error"],
                    "token_checked_at": info["token_checked_at"],
                }
            )
            saved = await page_store.upsert_page(updated_page)
            needs_att, reason = calculate_page_attention(
                saved,
                token_warn_days=settings.token_warn_days,
                data_access_warn_days=settings.data_access_warn_days,
            )
            if needs_att:
                stats["needs_attention"] += 1
                await send_page_attention_alert(saved, reason or "Attention requise", store=page_store)
            stats[saved.status] = stats.get(saved.status, 0) + 1
        except PermissionDeniedError as exc:
            reauth_reason = exc.details.get("reauth_reason", "Application retirée par l'utilisateur")
            saved = await page_store.set_status(
                str(page.id),
                "revoked",
                error="app_revoked",
                reauth_reason=reauth_reason,
            )
            stats["revoked"] += 1
            if saved:
                await send_page_attention_alert(saved, reauth_reason, store=page_store)
        except TokenExpiredError as exc:
            reauth_reason = exc.details.get("reauth_reason", "Jeton expiré")
            saved = await page_store.set_status(
                str(page.id),
                "reauth_required",
                error="token_expired",
                reauth_reason=reauth_reason,
            )
            stats["reauth_required"] += 1
            if saved:
                await send_page_attention_alert(saved, reauth_reason, store=page_store)
        except TargetValidationError as exc:
            saved = await page_store.set_status(
                str(page.id),
                "error",
                error="invalid_token_type",
                reauth_reason=exc.message,
            )
            stats["error"] += 1
            if saved:
                await send_page_attention_alert(saved, exc.message, store=page_store)
        except FacebookAPIError as exc:
            # Erreur transitoire ou réseau : ne jamais marquer en échec
            logger.warning("Échec temporaire de vérification pour la Page %s : %s", page.page_id, exc)
        except Exception as exc:
            logger.warning("Erreur inattendue lors de la vérification de la Page %s : %s", page.page_id, exc)
        finally:
            await graph.aclose()

    return stats

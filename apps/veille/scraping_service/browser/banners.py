"""Gestionnaire de fermeture des bannières cookies et popups intrusives."""

import asyncio
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from scraping_service.core.logging import logger

COOKIE_BANNER_SELECTORS = [
    # Boutons avec texte spécifique (FR et EN)
    'button:has-text("Tout refuser")',
    'button:has-text("Decline optional cookies")',
    'button:has-text("Refuser les cookies")',
    'button:has-text("Autoriser tous les cookies")',
    'button:has-text("Allow all cookies")',
    'button:has-text("Accepter tout")',
    'button:has-text("Accept all")',
    # Boutons de fermeture ou « Plus tard »
    '[role="button"]:has-text("Plus tard")',
    '[role="button"]:has-text("Not now")',
    '[role="button"]:has-text("Fermer")',
    '[role="button"]:has-text("Close")',
    'div[aria-label="Fermer"]',
    'div[aria-label="Close"]',
    'div[aria-label="Decline optional cookies"]',
    'div[aria-label="Autoriser tous les cookies"]',
]


async def dismiss_banners(page: Page, timeout_ms: int = 1500) -> bool:
    """Tente de fermer les bannières de cookies ou fenêtres d'incitation à la connexion."""
    closed_any = False
    for selector in COOKIE_BANNER_SELECTORS:
        try:
            locator = page.locator(selector).first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click(timeout=timeout_ms)
                logger.debug(f"Bannière/Modale fermée via sélecteur : {selector}")
                await asyncio.sleep(0.4)
                closed_any = True
        except (PlaywrightTimeoutError, Exception) as exc:
            logger.debug(f"Erreur mineure en fermant {selector}: {exc}")
            continue

    return closed_any

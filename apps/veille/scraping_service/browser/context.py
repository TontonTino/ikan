"""Fabrique de contextes de navigation Playwright configurés et sécurisés."""

from pathlib import Path
from typing import Any

from playwright.async_api import Browser, BrowserContext

from scraping_service.browser.stealth import (
    CHROMIUM_ARGS,
    DEFAULT_USER_AGENT,
    apply_stealth,
)
from scraping_service.config import settings
from scraping_service.core.logging import logger


async def create_browser_context(
    browser: Browser,
    storage_state_path: Path | None = None,
    user_agent: str | None = None,
    viewport: dict[str, int] | None = None,
) -> BrowserContext:
    """Crée un contexte Playwright avec les options optimales (locale, proxy, storage, stealth)."""
    options: dict[str, Any] = {
        "locale": settings.locale,
        "timezone_id": settings.timezone,
        "user_agent": user_agent or DEFAULT_USER_AGENT,
        "viewport": viewport or {"width": 1280, "height": 800},
        "device_scale_factor": 1.0,
        "has_touch": False,
        "is_mobile": False,
        "ignore_https_errors": True,
    }

    # Configuration du proxy si renseigné
    if settings.proxy_server:
        proxy_config: dict[str, str] = {"server": settings.proxy_server}
        if settings.proxy_username and settings.proxy_password:
            proxy_config["username"] = settings.proxy_username
            proxy_config["password"] = settings.proxy_password
        options["proxy"] = proxy_config
        logger.debug(f"Utilisation du proxy : {settings.proxy_server}")

    # Injection du fichier de session s'il existe
    if storage_state_path and storage_state_path.exists():
        options["storage_state"] = str(storage_state_path)
        logger.debug(f"Chargement de la session : {storage_state_path}")

    context = await browser.new_context(**options)

    if settings.stealth_enabled:
        await apply_stealth(context)

    return context

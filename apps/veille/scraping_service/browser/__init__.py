"""Module de gestion du navigateur et des contextes de navigation."""

from scraping_service.browser.banners import dismiss_banners
from scraping_service.browser.context import create_browser_context
from scraping_service.browser.stealth import (
    CHROMIUM_ARGS,
    DEFAULT_USER_AGENT,
    apply_stealth,
)

__all__ = [
    "CHROMIUM_ARGS",
    "DEFAULT_USER_AGENT",
    "apply_stealth",
    "create_browser_context",
    "dismiss_banners",
]

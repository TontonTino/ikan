"""Vérifie l'environnement Playwright, la connectivité et la configuration du service.

Usage : python -m scripts.check_setup
"""

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.async_api import async_playwright

from scraping_service.browser.context import create_browser_context
from scraping_service.browser.stealth import CHROMIUM_ARGS
from scraping_service.config import settings
from scraping_service.facebook.auth import inspect_storage_state

URLS = {
    "facebook_standard": "https://www.facebook.com/login",
    "facebook_mbasic": "https://mbasic.facebook.com/",
}


async def main() -> None:
    print("\n" + "=" * 65)
    print("  IKAN AI - DIAGNOSTIC DE CONFIGURATION ET D'ENVIRONNEMENT")
    print("=" * 65)

    # 1. Vérification de la configuration
    print(f"\n[1] Configuration :")
    print(f"    - Headless mode      : {settings.headless}")
    print(f"    - Locale / Timezone  : {settings.locale} / {settings.timezone}")
    print(f"    - Stealth activé     : {settings.stealth_enabled}")
    print(f"    - Proxy configuré    : {settings.proxy_server or 'Non'}")
    print(f"    - Timeout navigation : {settings.nav_timeout_ms} ms")

    # 2. Vérification de la session
    session_info = inspect_storage_state()
    print(f"\n[2] Session Facebook :")
    if session_info.get("valid"):
        print(f"    - Statut   : [VALIDE]")
        print(f"    - User ID  : {session_info.get('user_id')}")
        print(f"    - Expire   : {session_info.get('expires_at')}")
    else:
        print(f"    - Statut   : [NON VALIDE] ({session_info.get('message')})")

    # 3. Test de connectivité Playwright
    print(f"\n[3] Connectivité Playwright (Chromium) :")
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=settings.headless,
                args=CHROMIUM_ARGS,
            )
            print(f"    - Chromium lancé avec succès (version {browser.version})")
            context = await create_browser_context(browser)
            page = await context.new_page()
            page.set_default_navigation_timeout(settings.nav_timeout_ms)

            for label, url in URLS.items():
                try:
                    response = await page.goto(url, wait_until="domcontentloaded")
                    status_code = response.status if response else "n/a"
                    title = await page.title()
                    print(f"    - [{label}] OK (HTTP {status_code}) -> '{title[:40]}'")
                except Exception as exc:
                    print(f"    - [{label}] ÉCHEC : {exc}")

            await browser.close()
    except Exception as exc:
        print(f"    [ERREUR PLAYWRIGHT] Impossible de démarrer Chromium : {exc}")

    print("\n" + "=" * 65 + "\n")


if __name__ == "__main__":
    asyncio.run(main())

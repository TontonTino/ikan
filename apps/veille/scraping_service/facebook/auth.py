"""Gestion professionnelle de l'authentification et de la session Facebook."""

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from playwright.async_api import BrowserContext, async_playwright

from scraping_service.browser.banners import dismiss_banners
from scraping_service.browser.context import create_browser_context
from scraping_service.browser.stealth import CHROMIUM_ARGS
from scraping_service.config import settings
from scraping_service.core.logging import logger


def inspect_storage_state(state_path: Path | None = None) -> dict[str, Any]:
    """Inspecte rapidement le fichier de session sans lancer de navigateur."""
    path = state_path or settings.storage_state_path("facebook")
    if not path.exists():
        return {
            "valid": False,
            "exists": False,
            "path": str(path.resolve()),
            "message": "Fichier de session introuvable.",
        }

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        cookies = data.get("cookies", [])
    except Exception as exc:
        return {
            "valid": False,
            "exists": True,
            "path": str(path.resolve()),
            "message": f"Fichier de session illisible ou corrompu: {exc}",
        }

    c_user_cookie = next((c for c in cookies if c.get("name") == "c_user"), None)
    xs_cookie = next((c for c in cookies if c.get("name") == "xs"), None)

    if not c_user_cookie or not xs_cookie:
        return {
            "valid": False,
            "exists": True,
            "path": str(path.resolve()),
            "message": "Cookies essentiels 'c_user' ou 'xs' manquants dans le fichier de session.",
        }

    user_id = c_user_cookie.get("value")
    expires_ts = c_user_cookie.get("expires", 0)
    now_ts = datetime.now(timezone.utc).timestamp()

    is_expired = expires_ts > 0 and expires_ts < now_ts
    expires_iso = (
        datetime.fromtimestamp(expires_ts, tz=timezone.utc).isoformat()
        if expires_ts > 0
        else None
    )

    if is_expired:
        return {
            "valid": False,
            "exists": True,
            "user_id": user_id,
            "is_expired": True,
            "expires_at": expires_iso,
            "path": str(path.resolve()),
            "message": f"Session expirée depuis le {expires_iso}.",
        }

    return {
        "valid": True,
        "exists": True,
        "user_id": user_id,
        "is_expired": False,
        "expires_at": expires_iso,
        "path": str(path.resolve()),
        "message": f"Session valide pour l'utilisateur ID {user_id} (expire le {expires_iso or 'indéterminé'}).",
    }


async def is_authenticated(context: BrowserContext) -> bool:
    """Vérifie la présence du cookie clé d'authentification Facebook (c_user)."""
    cookies = await context.cookies()
    return any(c.get("name") == "c_user" for c in cookies)


async def login_and_save_state(login_url: str = "https://www.facebook.com/login") -> Path:
    """Ouvre Facebook dans un navigateur visible pour se connecter manuellement,
    puis sauvegarde les cookies et l'état de session dans state/facebook_storage_state.json.
    """
    state_path = settings.storage_state_path("facebook")

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=False,
            args=CHROMIUM_ARGS,
        )
        context = await create_browser_context(browser)
        page = await context.new_page()
        page.set_default_navigation_timeout(settings.nav_timeout_ms)

        print("\n" + "=" * 65)
        print("  IKAN AI - CONNEXION INTERACTIVE FACEBOOK")
        print("=" * 65)
        print("1. Le navigateur Chromium s'ouvre.")
        print("2. Connectez-vous avec les identifiants de votre compte dédié.")
        print("3. Validez la double authentification (2FA) si activée.")
        print("4. Une fois connecté sur la page d'accueil, revenez ici et")
        print("   appuyez sur [ENTRÉE] pour sauvegarder la session.")
        print("=" * 65 + "\n")

        await page.goto(login_url, wait_until="domcontentloaded")
        await dismiss_banners(page)

        # Attente interactive
        await asyncio.to_thread(input, "Appuyez sur [ENTRÉE] après avoir validé la connexion dans la fenêtre... ")

        # Vérification des cookies
        auth_ok = await is_authenticated(context)
        if not auth_ok:
            await browser.close()
            raise RuntimeError(
                "Connexion non confirmée (cookie 'c_user' absent). "
                "Veuillez vous assurer d'être bien connecté sur Facebook avant d'appuyer sur Entrée."
            )

        await context.storage_state(path=str(state_path))
        print(f"[SUCCÈS] Session sauvegardée avec succès dans : {state_path.resolve()}")
        await browser.close()
        return state_path


async def check_session_active() -> dict[str, Any]:
    """Effectue un test de connexion headless actif sur Facebook."""
    inspection = inspect_storage_state()
    if not inspection.get("valid"):
        print(f"[AVERTISSEMENT] {inspection.get('message')}")
        return {"active": False, "reason": inspection.get("message")}

    state_path = Path(inspection["path"])

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=CHROMIUM_ARGS,
        )
        try:
            context = await create_browser_context(browser, storage_state_path=state_path)
            page = await context.new_page()
            page.set_default_navigation_timeout(settings.nav_timeout_ms)

            logger.info("Test de session actif sur https://www.facebook.com/...")
            await page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
            await asyncio.sleep(2)
            await dismiss_banners(page)

            final_url = page.url.lower()
            login_form = page.locator('input[name="email"], input[name="pass"]')
            has_login_fields = await login_form.count() > 0

            if "checkpoint" in final_url:
                print(f"[BLOCAGE] Compte soumis à un checkpoint Facebook: {page.url}")
                return {"active": False, "reason": "Facebook checkpoint detected"}

            if "login" in final_url or has_login_fields:
                print(f"[EXPIRÉ] Redirigé vers le formulaire de connexion ({final_url}).")
                return {"active": False, "reason": "Redirected to login form"}

            auth_ok = await is_authenticated(context)
            if auth_ok:
                print(f"[SUCCÈS] La session est pleinement active et opérationnelle !")
                return {"active": True, "user_id": inspection.get("user_id")}

            print("[EXPIRÉ] Cookie c_user absent lors de la navigation.")
            return {"active": False, "reason": "c_user cookie missing during navigation"}
        finally:
            await browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="https://www.facebook.com/login", help="URL de connexion")
    parser.add_argument("--check", action="store_true", help="Vérifier la validité de la session en direct")
    parser.add_argument("--status", action="store_true", help="Afficher l'état local du fichier de session")
    args = parser.parse_args()

    if args.status:
        result = inspect_storage_state()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif args.check:
        asyncio.run(check_session_active())
    else:
        asyncio.run(login_and_save_state(args.url))


if __name__ == "__main__":
    main()

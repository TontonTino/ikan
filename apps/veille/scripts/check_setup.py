"""Vérifie la configuration Meta Graph API, la connectivité et la validité du token.

Usage : python -m scripts.check_setup
"""

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from scraping_service.config import settings
from scraping_service.facebook.tokens import inspect_token


async def main() -> None:
    print("\n" + "=" * 65)
    print("  IKAN AI - DIAGNOSTIC META GRAPH API")
    print("=" * 65)

    # 1. Vérification de la configuration
    print("\n[1] Configuration :")
    print(f"    - Version Graph API : {settings.fb_api_version}")
    print(f"    - App ID Meta       : {settings.fb_app_id or 'Non configuré'}")
    print(f"    - App Secret Meta   : {'******' if settings.fb_app_secret else 'Non configuré'}")
    print(f"    - Page ID par défaut: {settings.fb_default_page_id or 'Non configuré'}")

    # 2. Vérification du Jeton d'accès (Token)
    print("\n[2] Statut du Jeton d'accès Facebook :")
    token_status = await inspect_token()
    if token_status.get("valid"):
        print("    - Statut : [VALIDE]")
        print(f"    - Cible  : {token_status.get('name')} (ID: {token_status.get('id')})")
        print(f"    - Message: {token_status.get('message')}")
    else:
        print("    - Statut : [NON VALIDE]")
        print(f"    - Message: {token_status.get('message')}")
        print("\n💡 Conseil : Générez un nouveau jeton dans Meta Graph API Explorer et mettez à jour votre .env")

    print("\n" + "=" * 65)


if __name__ == "__main__":
    asyncio.run(main())

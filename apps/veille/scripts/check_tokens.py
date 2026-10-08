"""Vérifie les tokens chiffrés des Pages connectées via debug_token.

Usage : python -m scripts.check_tokens
"""

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from scraping_service.core.page_store import FilePageStore
from scraping_service.services.token_lifecycle import check_all_pages_tokens


async def main() -> int:
    print("\n🔍 Contrôle du cycle de vie des jetons de Pages...")
    store = FilePageStore()
    stats = await check_all_pages_tokens(store=store)
    print("\n📊 Résultats du contrôle :")
    print(f"    - Pages vérifiées      : {stats['checked']}")
    print(f"    - Actives              : {stats.get('active', 0)}")
    print(f"    - Réauth requise       : {stats.get('reauth_required', 0)}")
    print(f"    - Révoquées            : {stats.get('revoked', 0)}")
    print(f"    - Erreurs              : {stats.get('error', 0)}")
    print(f"    - Requiert attention   : {stats.get('needs_attention', 0)}")
    print("\n✅ Contrôle terminé.\n")
    return 1 if (stats.get("reauth_required", 0) + stats.get("error", 0)) > 0 else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
"""Rechiffre tous les tokens persistés avec la clé de chiffrement principale (MultiFernet).

Usage : python -m scripts.rotate_encryption_key
"""

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from scraping_service.core.crypto import decrypt_token, encrypt_token
from scraping_service.core.page_store import FilePageStore


async def rotate_keys(store: FilePageStore | None = None) -> int:
    page_store = store or FilePageStore()
    pages = await page_store.list_pages()
    rotated_count = 0

    for page in pages:
        if not page.page_token_encrypted or page.status == "revoked":
            continue
        # Déchiffrement avec la collection de clés MultiFernet
        plain_token = decrypt_token(page.page_token_encrypted)
        # Rechiffrement avec la clé primaire (la première de VEILLE_TOKEN_ENCRYPTION_KEY)
        new_encrypted_token = encrypt_token(plain_token)
        if new_encrypted_token != page.page_token_encrypted:
            updated_page = page.model_copy(update={"page_token_encrypted": new_encrypted_token})
            await page_store.upsert_page(updated_page)
            rotated_count += 1

    return rotated_count


async def main() -> None:
    print("\n🔄 Démarrage de la rotation des clés de chiffrement des jetons...")
    store = FilePageStore()
    count = await rotate_keys(store)
    print(f"✅ Rotation terminée : {count} jeton(s) rechiffré(s) avec la clé principale.\n")


if __name__ == "__main__":
    asyncio.run(main())

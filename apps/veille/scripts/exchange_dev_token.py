"""Script d'échange et d'enregistrement sécurisé d'un token de développement.

Lit un jeton court depuis Graph API Explorer via saisie masquée (getpass),
l'échange contre un jeton longue durée, valide le type PAGE via debug_token,
et enregistre la Page connectée de manière chiffrée dans PageStore.

Usage : python -m scripts.exchange_dev_token [--client-id <id>]
"""

import argparse
import asyncio
from datetime import datetime, timezone
import getpass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from scraping_service.config import settings
from scraping_service.core.crypto import encrypt_token
from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.tokens import inspect_and_validate_page_token


async def exchange_and_store_dev_token(
    raw_token: str,
    client_id: str = "dev-client",
    store: FilePageStore | None = None,
    graph_client: FacebookGraphClient | None = None,
) -> ConnectedPage:
    """Effectue l'échange complet et enregistre la Page chiffrée sans exposer le jeton."""
    if not raw_token or not raw_token.strip():
        raise ValueError("Le jeton fourni est vide.")

    page_store = store or FilePageStore()
    graph = graph_client or FacebookGraphClient(access_token="")
    own_graph = graph_client is None

    try:
        debug_info = await graph.debug_token(raw_token)
        token_type = str(debug_info.get("type", "")).upper()

        long_lived_token: str = raw_token
        page_id: str = ""
        page_name: str = ""
        category: str | None = None

        if token_type == "USER":
            long_resp = await graph.exchange_for_long_lived_token(raw_token)
            long_user_token = long_resp.get("access_token") or raw_token
            accounts = await graph.fetch_managed_pages(long_user_token)
            if not accounts:
                raise ValueError("Aucune Page Facebook gérée trouvée pour ce compte utilisateur.")
            target_page = accounts[0]
            if settings.fb_default_page_id:
                for acc in accounts:
                    if acc.get("id") == settings.fb_default_page_id:
                        target_page = acc
                        break
            page_token = target_page.get("access_token")
            if not page_token:
                raise ValueError("Impossible d'extraire le token de la Page Facebook.")
            long_lived_token = page_token
            page_id = str(target_page.get("id"))
            page_name = str(target_page.get("name") or "Page Dev")
            category = target_page.get("category")
        else:
            try:
                long_resp = await graph.exchange_for_long_lived_token(raw_token)
                if long_resp.get("access_token"):
                    long_lived_token = long_resp["access_token"]
            except Exception:
                pass

        validation = await inspect_and_validate_page_token(long_lived_token, client=graph)
        if not page_id or not page_name:
            if hasattr(graph, "get_page_info"):
                try:
                    page_info = await graph.get_page_info("me")
                    page_id = page_id or str(page_info.get("id", "dev_page"))
                    page_name = page_name or str(page_info.get("name", "Page Dev"))
                    category = category or page_info.get("category")
                except Exception:
                    page_id = page_id or str(debug_info.get("profile_id") or debug_info.get("user_id") or "dev_page")
                    page_name = page_name or "Page Dev"
            else:
                try:
                    transport = getattr(getattr(graph, "_http", None), "_transport", None)
                    page_info_graph = FacebookGraphClient(access_token=long_lived_token, transport=transport)
                    page_info = await page_info_graph.get_page_info("me")
                    page_id = page_id or str(page_info.get("id", "dev_page"))
                    page_name = page_name or str(page_info.get("name", "Page Dev"))
                    category = category or page_info.get("category")
                    await page_info_graph.aclose()
                except Exception:
                    page_id = page_id or str(debug_info.get("profile_id") or debug_info.get("user_id") or "dev_page")
                    page_name = page_name or "Page Dev"


        encrypted_token = encrypt_token(long_lived_token)
        connected_page = ConnectedPage(
            client_id=client_id,
            page_id=page_id,
            page_name=page_name,
            category=category,
            page_token_encrypted=encrypted_token,
            status=validation["status"],
            scopes=validation["scopes"],
            token_type=validation["token_type"],
            is_valid=validation["is_valid"],
            expires_at=validation["expires_at"],
            data_access_expires_at=validation["data_access_expires_at"],
            last_error=validation["last_error"],
            token_checked_at=datetime.now(timezone.utc),
        )

        saved = await page_store.upsert_page(connected_page)
        return saved
    finally:
        if own_graph:
            await graph.aclose()


def main(args: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Échange sécurisé d'un token Graph API Explorer")
    parser.add_argument("--client-id", default="dev-client", help="ID client IKAN AI (défaut: dev-client)")
    parsed_args = parser.parse_args(args)

    print("\n" + "=" * 65)
    print("  IKAN AI - ÉCHANGE SÉCURISÉ DE JETON DE DÉVELOPPEMENT")
    print("=" * 65)
    print("\n💡 Collez le jeton temporaire issu de Graph API Explorer (la saisie est masquée).")

    try:
        token = getpass.getpass("Jeton Graph API Explorer : ")
        if not token.strip():
            print("❌ Jeton vide. Annulation.")
            sys.exit(1)

        saved = asyncio.run(exchange_and_store_dev_token(token.strip(), client_id=parsed_args.client_id))

        print("\n✅ Jeton de Page échangé et enregistré avec succès !")
        print(f"    - Nom de la Page          : {saved.page_name}")
        print(f"    - ID de la Page           : {saved.page_id}")
        print(f"    - Expiration jeton        : {saved.expires_at} (0 = jamais)")
        print(f"    - Expiration accès données: {saved.data_access_expires_at or 'Illimitée/Non spécifiée'}")
        print(f"    - Statut                  : {saved.status}")
        print("\n🔒 Le jeton a été stocké de façon chiffrée et n'a jamais été exposé en clair.\n")
    except Exception as exc:
        print(f"\n❌ Erreur : {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()

"""Script CLI pour extraire les publications et commentaires Facebook via l'API Graph.

Usage :
    python -m scripts.scrape_facebook --target 1618870513365355 --max-items 50 --format json
    python -m scripts.scrape_facebook --target https://www.facebook.com/IKAN.AI --format csv
"""

import argparse
import asyncio
import csv
import json
from pathlib import Path
import sys

# Assure que la racine du projet est dans sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from scraping_service.config import settings
from scraping_service.core.crypto import decrypt_token
from scraping_service.core.exceptions import VeilleError
from scraping_service.core.page_store import FilePageStore
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.scraper import FacebookScraper, extract_page_identifier


def export_csv(items: list[dict], output_file: Path) -> bool:
    """Exporte les avis / commentaires extraits au format CSV standardisé."""
    if not items:
        return False
    headers = ["source_id", "published_at", "author_name", "permalink", "text", "target_url", "rating", "post_id"]
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            row = dict(item)
            if "metadata" in item and isinstance(item["metadata"], dict):
                row["post_id"] = item["metadata"].get("post_id")
            writer.writerow(row)
    return True


async def run(
    target: str,
    max_items: int,
    output: Path | None = None,
    out_format: str = "json",
    token: str | None = None,
) -> None:
    print(f"\n🚀 Démarrage de l'extraction Meta Graph API pour la cible : {target}")

    resolved_token = token
    if not resolved_token:
        try:
            page_store = FilePageStore()
            clean_target = extract_page_identifier(target)
            pages = await page_store.list_pages()
            for p in pages:
                if (p.page_id == clean_target or p.page_name.lower() == target.lower() or target == "me") and p.page_token_encrypted and p.status != "revoked":
                    try:
                        resolved_token = decrypt_token(p.page_token_encrypted)
                        break
                    except Exception:
                        pass
        except Exception:
            pass

    client = FacebookGraphClient(access_token=resolved_token) if resolved_token else None
    scraper = FacebookScraper(client=client) if client else FacebookScraper()

    try:
        items = await scraper.fetch(target=target, max_items=max_items)
    except VeilleError as exc:
        print(f"\n❌ [ERREUR VEILLE {exc.error_code}] : {exc.message}")
        sys.exit(1)
    except Exception as exc:
        print(f"\n❌ [ERREUR INATTENDUE] : {exc}")
        sys.exit(1)

    items_dump = [item.model_dump(mode="json") for item in items]
    print(f"\n✅ Extraction réussie : {len(items)} éléments collectés.")

    if not items:
        print("ℹ️ Aucun élément à sauvegarder.\n")
        return

    # Détermination du fichier de sortie
    if not output:
        clean_target = "".join(c if c.isalnum() else "_" for c in target)[:20]
        ext = "csv" if out_format == "csv" else "json"
        output = settings.get_data_path(f"facebook_{clean_target}.{ext}")

    output_path = Path(output)
    if out_format == "csv" or output_path.suffix.lower() == ".csv":
        if export_csv(items_dump, output_path):
            print(f"📁 Données sauvegardées dans : {output_path.resolve()}\n")
    else:
        payload = {
            "source": "facebook",
            "target": target,
            "count": len(items),
            "items": items_dump,
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"📁 Données sauvegardées dans : {output_path.resolve()}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extraction de veille Facebook via Meta Graph API")
    parser.add_argument(
        "--target",
        type=str,
        default=settings.fb_default_page_id or "me",
        help="ID de la page Facebook, URL ou 'me' (défaut: page par défaut)",
    )
    parser.add_argument(
        "--max-items",
        type=int,
        default=50,
        help="Nombre maximal de commentaires/avis à extraire (défaut: 50)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Chemin du fichier de sortie (défaut: data/facebook_<cible>.json)",
    )
    parser.add_argument(
        "--format",
        dest="out_format",
        choices=["json", "csv"],
        default="json",
        help="Format de sortie des données (défaut: json)",
    )
    parser.add_argument(
        "--token",
        type=str,
        default=None,
        help="Page Access Token spécifique (optionnel)",
    )

    args = parser.parse_args()
    asyncio.run(
        run(
            target=args.target,
            max_items=args.max_items,
            output=args.output,
            out_format=args.out_format,
            token=args.token,
        )
    )


if __name__ == "__main__":
    main()
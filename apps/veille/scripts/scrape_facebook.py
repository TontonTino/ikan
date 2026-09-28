"""Script CLI professionnel pour extraire une page Facebook et exporter les données."""

import argparse
import asyncio
import csv
import json
import logging
from pathlib import Path
import sys

# Assure que la racine du projet est dans sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from scraping_service.config import settings
from scraping_service.core.exceptions import VeilleError
from scraping_service.core.logging import logger
from scraping_service.facebook.auth import inspect_storage_state
from scraping_service.facebook.scraper import FacebookScraper


def export_csv(items: list[dict], output_file: Path) -> None:
    """Exporte les items extraits au format CSV standardisé."""
    if not items:
        return
    headers = ["source_id", "published_at", "author_name", "rating", "permalink", "text", "target_url"]
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            writer.writerow(item)


async def run(target: str, max_items: int, output: Path | None = None, out_format: str = "json") -> None:
    # 1. Pré-vérification de la session
    session_info = inspect_storage_state()
    if not session_info.get("valid"):
        print(f"\n[ATTENTION] Session Facebook non optimale : {session_info.get('message')}")
        print("Pour régénérer la session : python -m scraping_service.facebook.auth\n")

    scraper = FacebookScraper()
    try:
        items = await scraper.fetch(target, max_items)
    except VeilleError as exc:
        print(f"\n[ERREUR VEILLE {exc.error_code}] : {exc.message}")
        sys.exit(1)
    except Exception as exc:
        print(f"\n[ERREUR FATALE] : {exc}")
        sys.exit(1)

    items_dump = [item.model_dump(mode="json") for item in items]
    payload = {
        "source": "facebook",
        "target": target,
        "count": len(items),
        "items": items_dump,
    }

    if output:
        output_path = Path(output)
        if out_format == "csv" or output_path.suffix.lower() == ".csv":
            export_csv(items_dump, output_path)
        else:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        print("\n" + "=" * 60)
        print("  EXTRACTION TERMINÉE AVEC SUCCÈS")
        print("=" * 60)
        print(f"  - Cible       : {target}")
        print(f"  - Éléments    : {len(items)}")
        print(f"  - Fichier     : {output_path.resolve()}")
        print("=" * 60 + "\n")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="URL de la page Facebook à extraire")
    parser.add_argument("--max-items", type=int, default=20, help="Nombre de publications maximum")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie (.json ou .csv)")
    parser.add_argument("--format", choices=["json", "csv"], default="json", help="Format de sortie")
    parser.add_argument("-v", "--verbose", action="store_true", help="Activer le mode verbeux (logs DEBUG)")
    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    asyncio.run(run(args.target, args.max_items, args.output, args.format))


if __name__ == "__main__":
    main()
"""Script de planification simple pour relancer périodiquement un scraper Facebook."""

import argparse
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraping_service.core.jobs import ScrapeJobTracker
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.scraper import FacebookScraper


async def run_periodic(target: str, max_items: int, interval_seconds: int, token: str | None = None) -> None:
    tracker = ScrapeJobTracker()
    client = FacebookGraphClient(access_token=token) if token else None
    scraper = FacebookScraper(client=client) if client else FacebookScraper()

    while True:
        started_at = datetime.now(timezone.utc)
        try:
            items = await scraper.fetch(target=target, max_items=max_items)
            status = "success"
            count = len(items)
        except Exception as exc:
            status = "failed"
            count = 0
            print(f"[scheduler] Échec du job: {exc}")
            tracker.record_run(
                job_name="facebook_periodic",
                target=target,
                count=count,
                status=status,
                started_at=started_at,
                finished_at=datetime.now(timezone.utc),
                metadata={"error": str(exc)},
            )
            await asyncio.sleep(interval_seconds)
            continue

        finished_at = datetime.now(timezone.utc)
        tracker.record_run(
            job_name="facebook_periodic",
            target=target,
            count=count,
            status=status,
            started_at=started_at,
            finished_at=finished_at,
        )
        print(f"[scheduler] extraction terminée: {count} éléments - prochaine exécution dans {interval_seconds}s")
        await asyncio.sleep(interval_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Exécuter un scraper Facebook périodiquement.")
    parser.add_argument("--target", required=True, help="ID ou URL Facebook cible")
    parser.add_argument("--max-items", type=int, default=50, help="Nombre max d’éléments")
    parser.add_argument("--interval-seconds", type=int, default=300, help="Intervalle entre deux exécutions")
    parser.add_argument("--token", default=None, help="Token Facebook optionnel")
    args = parser.parse_args()
    asyncio.run(run_periodic(args.target, args.max_items, args.interval_seconds, args.token))


if __name__ == "__main__":
    main()

"""Persistance d'état pour les scrapes répétés et déduplication durable."""

import json
from datetime import datetime, timezone
from pathlib import Path

from scraping_service.base import FeedbackItem


class ScrapeStateStore:
    """Stocke l'état des dernières extractions par cible pour éviter les doublons."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else Path("data") / "scrape_state.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, dict[str, object]]:
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            return {}
        return {}

    def _save(self, state: dict[str, dict[str, object]]) -> None:
        self.path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    def filter_new(self, page_id: str, items: list[FeedbackItem]) -> list[FeedbackItem]:
        state = self.load()
        record = state.get(page_id, {})
        seen = set(record.get("last_seen_ids", []))
        new_items: list[FeedbackItem] = []

        for item in items:
            key = item.source_id or f"{item.text}:{item.published_at}"
            if key in seen:
                continue
            new_items.append(item)

        return new_items

    def record_run(self, page_id: str, items: list[FeedbackItem]) -> dict[str, object]:
        state = self.load()
        item_ids = []
        for item in items:
            key = item.source_id or f"{item.text}:{item.published_at}"
            if key not in item_ids:
                item_ids.append(key)

        state[page_id] = {
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_seen_ids": item_ids,
            "count": len(items),
        }
        self._save(state)
        return state[page_id]

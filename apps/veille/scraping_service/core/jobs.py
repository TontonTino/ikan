"""Suivi des jobs de scraping pour l'observabilité et la planification."""

import json
from datetime import datetime, timezone
from pathlib import Path


class ScrapeJobTracker:
    """Stocke l'historique des exécutions de scraping pour un suivi métier."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else Path("data") / "job_history.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> list[dict]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except (json.JSONDecodeError, OSError):
            pass
        return []

    def record_run(
        self,
        job_name: str,
        target: str,
        count: int,
        status: str,
        started_at: datetime | None = None,
        finished_at: datetime | None = None,
        metadata: dict | None = None,
    ) -> dict:
        payload = {
            "job_name": job_name,
            "target": target,
            "count": count,
            "status": status,
            "started_at": (started_at or datetime.now(timezone.utc)).isoformat(),
            "finished_at": (finished_at or datetime.now(timezone.utc)).isoformat(),
            "metadata": metadata or {},
        }

        history = self.load()
        history.append(payload)
        self.path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload

    def recent(self, limit: int = 10) -> list[dict]:
        history = self.load()
        return history[-limit:]

    def summary(self, limit: int = 10) -> dict:
        """Retourne un résumé de production des jobs récents : KPI, taux de succès et dernier run."""
        history = self.recent(limit=limit)
        total_runs = len(history)
        counts = {"success": 0, "failed": 0, "running": 0}
        for entry in history:
            state = str(entry.get("status", "unknown")).lower()
            if state in counts:
                counts[state] += 1

        success_count = counts["success"]
        success_rate = round(success_count / total_runs, 2) if total_runs else 0.0
        last_run = history[-1] if history else None

        return {
            "total_runs": total_runs,
            "status_counts": counts,
            "success_rate": success_rate,
            "last_run": last_run,
            "recent_runs": history,
        }

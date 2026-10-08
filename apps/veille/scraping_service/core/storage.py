"""Stockage durable des feedbacks pour un usage production."""

import json
import sqlite3
from pathlib import Path
from typing import Any

from scraping_service.base import FeedbackItem


class FeedbackStore:
    """Persistance SQLite des éléments de feedback pour historique durable et requêtes rapides."""

    def __init__(self, db_path: str | Path = "data/feedback.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    target_url TEXT NOT NULL,
                    author_name TEXT,
                    text TEXT NOT NULL,
                    rating REAL,
                    published_at TEXT,
                    permalink TEXT,
                    raw_text TEXT,
                    metadata_json TEXT,
                    UNIQUE(source, source_id)
                )
                """
            )
            conn.commit()

    def save_many(self, items: list[FeedbackItem]) -> int:
        """Enregistre plusieurs éléments, sans dupliquer les entries déjà existantes."""
        if not items:
            return 0

        inserted = 0
        with self._connect() as conn:
            for item in items:
                payload = (
                    item.source,
                    item.source_id,
                    item.target_url,
                    item.author_name,
                    item.text,
                    item.rating,
                    item.published_at.isoformat() if item.published_at else None,
                    item.permalink,
                    item.raw_text,
                    json.dumps(item.metadata, ensure_ascii=False, default=str),
                )
                try:
                    conn.execute(
                        """
                        INSERT INTO feedback (
                            source, source_id, target_url, author_name, text, rating,
                            published_at, permalink, raw_text, metadata_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        payload,
                    )
                    inserted += 1
                except sqlite3.IntegrityError:
                    continue
            conn.commit()
        return inserted

    def list_by_target(self, target_url: str, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT source, source_id, target_url, author_name, text, rating,
                       published_at, permalink, raw_text, metadata_json
                FROM feedback
                WHERE target_url = ?
                ORDER BY published_at DESC, id DESC
                LIMIT ?
                """,
                (target_url, limit),
            ).fetchall()

        return [
            {
                "source": row["source"],
                "source_id": row["source_id"],
                "target_url": row["target_url"],
                "author_name": row["author_name"],
                "text": row["text"],
                "rating": row["rating"],
                "published_at": row["published_at"],
                "permalink": row["permalink"],
                "raw_text": row["raw_text"],
                "metadata": json.loads(row["metadata_json"] or "{}"),
            }
            for row in rows
        ]

    def count_by_target(self, target_url: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS total FROM feedback WHERE target_url = ?",
                (target_url,),
            ).fetchone()
            return int(row["total"]) if row else 0

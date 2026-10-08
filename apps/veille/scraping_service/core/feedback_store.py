"""Stockage JSONL des feedbacks, séparé par client et Page."""

import json
import os
import re
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from scraping_service.base import FeedbackItem
from scraping_service.config import settings
from scraping_service.core.logging import logger


_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def validate_storage_id(value: str) -> str:
    if not _SAFE_ID.fullmatch(value):
        raise ValueError("L'identifiant de stockage contient des caractères non autorisés.")
    return value


class FileFeedbackStore:
    """Écrit les feedbacks dans data/feedback et les IDs vus dans state/seen."""

    def __init__(self, data_dir: str | Path | None = None, state_dir: str | Path | None = None):
        self.data_dir = Path(data_dir) if data_dir else settings.data_dir
        self.state_dir = Path(state_dir) if state_dir else settings.state_dir

    def feedback_path(self, client_id: str, page_id: str) -> Path:
        return self.data_dir / "feedback" / validate_storage_id(client_id) / f"{validate_storage_id(page_id)}.jsonl"

    def seen_path(self, page_id: str) -> Path:
        return self.state_dir / "seen" / f"{validate_storage_id(page_id)}.txt"

    def load_seen(self, page_id: str) -> set[str]:
        try:
            return set(self.seen_path(page_id).read_text(encoding="utf-8").splitlines())
        except FileNotFoundError:
            return set()
        except OSError:
            logger.warning("Impossible de lire les IDs déjà collectés; reprise sans index de déduplication.")
            return set()

    @staticmethod
    def _existing_ids(path: Path) -> set[str]:
        if not path.exists():
            return set()
        existing: set[str] = set()
        try:
            with path.open(encoding="utf-8") as stream:
                for line in stream:
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    source_id = record.get("source_id")
                    if isinstance(source_id, str):
                        existing.add(source_id)
        except OSError:
            logger.warning("Impossible de lire les feedbacks existants; aucune donnée n'est supprimée.")
        return existing

    @staticmethod
    def _write_seen(path: Path, source_ids: set[str]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f"{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write("".join(f"{source_id}\n" for source_id in sorted(source_ids)))
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)
        if os.name != "nt":
            os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, path)
        if os.name != "nt":
            os.chmod(path, 0o600)

    def append_new(self, client_id: str, page_id: str, items: list[FeedbackItem]) -> list[FeedbackItem]:
        path = self.feedback_path(client_id, page_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        existing_ids = self._existing_ids(path)
        seen_ids = self.load_seen(page_id)
        new_items: list[FeedbackItem] = []
        for item in items:
            if not item.source_id or item.source_id in existing_ids:
                continue
            new_items.append(
                item if settings.store_author_name else item.model_copy(update={"author_name": None})
            )
            existing_ids.add(item.source_id)
        if new_items:
            with path.open("a", encoding="utf-8") as stream:
                for item in new_items:
                    stream.write(item.model_dump_json() + "\n")
                stream.flush()
                os.fsync(stream.fileno())
        self._write_seen(self.seen_path(page_id), seen_ids | existing_ids)
        return new_items

    def list_items(self, client_id: str, *, offset: int = 0, limit: int = 100) -> list[dict[str, Any]]:
        client_directory = self.data_dir / "feedback" / validate_storage_id(client_id)
        if not client_directory.exists():
            return []
        records: list[dict[str, Any]] = []
        for path in sorted(client_directory.glob("*.jsonl")):
            try:
                with path.open(encoding="utf-8") as stream:
                    for line in stream:
                        try:
                            record = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(record, dict):
                            records.append(record)
            except OSError:
                logger.warning("Impossible de lire un fichier de feedback.")
        return records[offset : offset + limit]

    def purge_page(self, client_id: str, page_id: str) -> None:
        path = self.feedback_path(client_id, page_id)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Impossible de supprimer le fichier de feedback demandé.")
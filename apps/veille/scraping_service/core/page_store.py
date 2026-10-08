"""Stockage de Pages sur fichier JSON pour les déploiements à instance unique."""

import asyncio
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from scraping_service.config import settings
from scraping_service.core.logging import logger
from scraping_service.core.pages import ConnectedPage, PageStatus


_FILE_LOCK = asyncio.Lock()


class FilePageStore:
    """Persiste les Pages dans state/pages.json avec remplacement atomique."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else settings.state_dir / "pages.json"

    async def _read(self) -> list[ConnectedPage]:
        try:
            raw: Any = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(raw, list):
                raise ValueError("Le contenu racine n'est pas une liste.")
            return [ConnectedPage.model_validate(record) for record in raw]
        except FileNotFoundError:
            return []
        except (OSError, json.JSONDecodeError, ValidationError, ValueError):
            logger.warning("Fichier des Pages absent ou invalide; démarrage avec une liste vide.")
            return []

    def _write(self, pages: list[ConnectedPage]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            [page.model_dump(mode="json") for page in pages],
            ensure_ascii=False,
            indent=2,
        )
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=self.path.parent,
            prefix=f"{self.path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write(payload)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)
        if os.name != "nt":
            os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, self.path)
        if os.name != "nt":
            os.chmod(self.path, 0o600)

    async def list_pages(self, client_id: str | None = None) -> list[ConnectedPage]:
        async with _FILE_LOCK:
            pages = await self._read()
            return [page for page in pages if client_id is None or page.client_id == client_id]

    async def get_page(self, page_id: str | UUID) -> ConnectedPage | None:
        identifier = str(page_id)
        async with _FILE_LOCK:
            return next((page for page in await self._read() if str(page.id) == identifier), None)

    async def upsert_page(self, page: ConnectedPage) -> ConnectedPage:
        async with _FILE_LOCK:
            pages = await self._read()
            existing_index = next(
                (
                    index
                    for index, existing in enumerate(pages)
                    if existing.client_id == page.client_id and existing.page_id == page.page_id
                ),
                None,
            )
            if existing_index is None:
                pages.append(page)
            else:
                existing = pages[existing_index]
                page = page.model_copy(update={"id": existing.id, "connected_at": existing.connected_at})
                pages[existing_index] = page
            self._write(pages)
            return page

    async def delete_page(self, page_id: str | UUID) -> ConnectedPage | None:
        return await self.set_status(page_id, "revoked")

    async def set_status(
        self,
        page_id: str | UUID,
        page_status: PageStatus,
        error: str | None = None,
        reauth_reason: str | None = None,
    ) -> ConnectedPage | None:
        identifier = str(page_id)
        async with _FILE_LOCK:
            pages = await self._read()
            for index, page in enumerate(pages):
                if str(page.id) == identifier:
                    updates: dict[str, Any] = {
                        "status": page_status,
                        "last_error": error,
                        "page_token_encrypted": "" if page_status == "revoked" else page.page_token_encrypted,
                    }
                    if reauth_reason is not None:
                        updates["reauth_reason"] = reauth_reason
                    elif page_status == "active":
                        updates["reauth_reason"] = None
                    updated = page.model_copy(update=updates)
                    pages[index] = updated
                    self._write(pages)
                    return updated
            return None

    async def update_last_sync(self, page_id: str | UUID, dt: Any) -> ConnectedPage | None:
        identifier = str(page_id)
        async with _FILE_LOCK:
            pages = await self._read()
            for index, page in enumerate(pages):
                if str(page.id) == identifier:
                    updated = page.model_copy(update={"last_sync_at": dt, "last_error": None})
                    pages[index] = updated
                    self._write(pages)
                    return updated
            return None
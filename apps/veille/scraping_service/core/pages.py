"""Modèle et contrat de persistance des Pages Facebook connectées."""

from datetime import datetime, timezone
from typing import Literal, Protocol
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


PageStatus = Literal["active", "reauth_required", "revoked", "error"]


class ConnectedPage(BaseModel):
    """Page connectée, avec son jeton conservé uniquement sous forme chiffrée."""

    id: UUID = Field(default_factory=uuid4)
    client_id: str
    page_id: str
    page_name: str
    category: str | None = None
    page_token_encrypted: str
    status: PageStatus = "active"
    scopes: list[str] = Field(default_factory=list)
    token_type: str | None = None
    is_valid: bool = True
    expires_at: int | None = None
    data_access_expires_at: int | None = None
    reauth_reason: str | None = None
    connected_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    token_checked_at: datetime | None = None
    last_sync_at: datetime | None = None
    last_error: str | None = None
    last_alerted_state: str | None = None


from math import ceil


def calculate_page_attention(
    page: ConnectedPage,
    now_ts: float | None = None,
    token_warn_days: int = 7,
    data_access_warn_days: int = 14,
) -> tuple[bool, str | None]:
    """Détermine si la Page requiert une attention et retourne la raison associée."""
    if now_ts is None:
        now_ts = datetime.now(timezone.utc).timestamp()

    if page.status in {"reauth_required", "revoked", "error"}:
        reason = page.reauth_reason or page.last_error or f"Statut anormal : {page.status}"
        return True, reason

    if not page.is_valid:
        reason = page.reauth_reason or page.last_error or "Jeton invalide"
        return True, reason

    if page.expires_at is not None and page.expires_at > 0:
        seconds_left = page.expires_at - now_ts
        if seconds_left <= token_warn_days * 86400:
            days = max(0, int(ceil(seconds_left / 86400)))
            return True, f"Le jeton expire dans {days} jour(s)"

    if page.data_access_expires_at is not None and page.data_access_expires_at > 0:
        seconds_left = page.data_access_expires_at - now_ts
        if seconds_left <= data_access_warn_days * 86400:
            days = max(0, int(ceil(seconds_left / 86400)))
            return True, f"L'accès aux données expire dans {days} jour(s)"

    return False, None



class PageStore(Protocol):
    """Interface des opérations requises sur les Pages connectées."""

    async def list_pages(self, client_id: str | None = None) -> list[ConnectedPage]: ...

    async def get_page(self, page_id: str | UUID) -> ConnectedPage | None: ...

    async def upsert_page(self, page: ConnectedPage) -> ConnectedPage: ...

    async def delete_page(self, page_id: str | UUID) -> ConnectedPage | None: ...

    async def set_status(
        self,
        page_id: str | UUID,
        page_status: PageStatus,
        error: str | None = None,
        reauth_reason: str | None = None,
    ) -> ConnectedPage | None: ...

    async def update_last_sync(self, page_id: str | UUID, dt: datetime) -> ConnectedPage | None: ...
import asyncio
from datetime import datetime, timezone
import json

from scraping_service.core.page_store import FilePageStore
from scraping_service.core.pages import ConnectedPage


def make_page(client_id="client-a", page_id="page-1", token="ciphertext"):
    return ConnectedPage(
        client_id=client_id,
        page_id=page_id,
        page_name="Page test",
        page_token_encrypted=token,
    )


def test_file_page_store_upserts_by_client_and_page(tmp_path):
    path = tmp_path / "state" / "pages.json"
    store = FilePageStore(path)
    first = asyncio.run(store.upsert_page(make_page()))
    replacement = asyncio.run(store.upsert_page(make_page(token="rotated-ciphertext")))

    assert replacement.id == first.id
    assert len(asyncio.run(store.list_pages("client-a"))) == 1
    assert asyncio.run(store.list_pages("client-b")) == []
    assert "rotated-ciphertext" in path.read_text(encoding="utf-8")
    assert "test-token" not in path.read_text(encoding="utf-8")


def test_missing_or_corrupt_file_returns_empty_list(tmp_path):
    path = tmp_path / "state" / "pages.json"
    store = FilePageStore(path)

    assert asyncio.run(store.list_pages()) == []
    path.parent.mkdir(parents=True)
    path.write_text("{invalid", encoding="utf-8")
    assert asyncio.run(store.list_pages()) == []


def test_delete_page_revokes_and_removes_encrypted_token(tmp_path):
    path = tmp_path / "pages.json"
    store = FilePageStore(path)
    page = asyncio.run(store.upsert_page(make_page()))

    revoked = asyncio.run(store.delete_page(page.id))

    assert revoked is not None
    assert revoked.status == "revoked"
    assert revoked.page_token_encrypted == ""
    assert json.loads(path.read_text(encoding="utf-8"))[0]["page_token_encrypted"] == ""


def test_last_sync_update_is_persisted(tmp_path):
    store = FilePageStore(tmp_path / "pages.json")
    page = asyncio.run(store.upsert_page(make_page()))
    synced_at = datetime.now(timezone.utc)

    updated = asyncio.run(store.update_last_sync(page.id, synced_at))

    assert updated is not None
    assert updated.last_sync_at == synced_at
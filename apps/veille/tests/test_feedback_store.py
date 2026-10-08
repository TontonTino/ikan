import json
from datetime import datetime, timezone

import pytest

from scraping_service.base import FeedbackItem
from scraping_service.config import settings
from scraping_service.core.feedback_store import FileFeedbackStore


def feedback(source_id="comment-1", author_name="Private Name"):
    return FeedbackItem(
        source="facebook",
        source_id=source_id,
        target_url="https://facebook.com/page-1",
        author_name=author_name,
        author_hash="salted-hash",
        text="Commentaire test",
        published_at=datetime.now(timezone.utc),
    )


def test_feedback_is_idempotent_and_author_name_is_not_stored_by_default(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "store_author_name", False)
    store = FileFeedbackStore(tmp_path / "data", tmp_path / "state")

    first = store.append_new("client-a", "page-1", [feedback(), feedback()])
    second = store.append_new("client-a", "page-1", [feedback()])
    path = store.feedback_path("client-a", "page-1")
    saved = json.loads(path.read_text(encoding="utf-8").splitlines()[0])

    assert len(first) == 1
    assert second == []
    assert saved["author_name"] is None
    assert saved["author_hash"] == "salted-hash"
    assert len(path.read_text(encoding="utf-8").splitlines()) == 1
    assert store.load_seen("page-1") == {"comment-1"}


def test_same_page_feedback_is_isolated_per_client(tmp_path):
    store = FileFeedbackStore(tmp_path / "data", tmp_path / "state")
    store.append_new("client-a", "page-1", [feedback()])
    store.append_new("client-b", "page-1", [feedback()])

    assert len(store.list_items("client-a")) == 1
    assert len(store.list_items("client-b")) == 1


def test_feedback_storage_rejects_path_traversal(tmp_path):
    store = FileFeedbackStore(tmp_path / "data", tmp_path / "state")

    with pytest.raises(ValueError):
        store.feedback_path("../other", "page-1")


def test_purge_removes_only_the_client_page_file(tmp_path):
    store = FileFeedbackStore(tmp_path / "data", tmp_path / "state")
    store.append_new("client-a", "page-1", [feedback()])
    store.append_new("client-b", "page-1", [feedback()])

    store.purge_page("client-a", "page-1")

    assert store.list_items("client-a") == []
    assert len(store.list_items("client-b")) == 1
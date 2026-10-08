from datetime import datetime

from scraping_service.base import FeedbackItem
from scraping_service.core.storage import FeedbackStore


def test_feedback_store_persists_and_reads_records(tmp_path):
    db_path = tmp_path / "feedback.db"
    store = FeedbackStore(db_path)

    items = [
        FeedbackItem(
            source="facebook",
            source_id="comment_1",
            target_url="https://facebook.com/page",
            author_name="Alice",
            text="Très bon avis",
            rating=5.0,
            published_at=datetime(2025, 1, 1, 12, 0, 0),
            permalink="https://facebook.com/comment_1",
            metadata={"post_id": "post_1"},
        ),
        FeedbackItem(
            source="facebook",
            source_id="comment_2",
            target_url="https://facebook.com/page",
            author_name="Bob",
            text="Service correct",
            rating=3.5,
            published_at=datetime(2025, 1, 2, 12, 0, 0),
            permalink="https://facebook.com/comment_2",
            metadata={"post_id": "post_1"},
        ),
    ]

    store.save_many(items)
    stored = store.list_by_target("https://facebook.com/page", limit=10)

    assert len(stored) == 2
    assert {item["source_id"] for item in stored} == {"comment_1", "comment_2"}
    assert stored[0]["author_name"] in {"Alice", "Bob"}


def test_feedback_store_avoids_duplicates_for_same_source_id(tmp_path):
    db_path = tmp_path / "feedback.db"
    store = FeedbackStore(db_path)

    item = FeedbackItem(
        source="facebook",
        source_id="duplicate_1",
        target_url="https://facebook.com/page",
        author_name="Alice",
        text="Sans doublon",
        published_at=datetime(2025, 1, 1, 12, 0, 0),
    )

    store.save_many([item])
    store.save_many([item])

    rows = store.list_by_target("https://facebook.com/page")
    assert len(rows) == 1
    assert rows[0]["source_id"] == "duplicate_1"

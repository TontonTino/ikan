from datetime import datetime

from scraping_service.base import FeedbackItem
from scraping_service.core.state import ScrapeStateStore


def test_scrape_state_store_tracks_seen_ids(tmp_path):
    store = ScrapeStateStore(path=tmp_path / "state.json")
    items = [
        FeedbackItem(
            source="facebook",
            source_id="comment_1",
            target_url="https://facebook.com/page",
            text="Bonjour",
            published_at=datetime(2025, 1, 1),
        ),
        FeedbackItem(
            source="facebook",
            source_id="comment_2",
            target_url="https://facebook.com/page",
            text="Salut",
            published_at=datetime(2025, 1, 2),
        ),
    ]

    new_items = store.filter_new("page_1", items)
    assert len(new_items) == 2

    store.record_run("page_1", items)
    filtered_again = store.filter_new("page_1", items)
    assert filtered_again == []

    storage = store.load()
    assert storage["page_1"]["last_seen_ids"] == ["comment_1", "comment_2"]

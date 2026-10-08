import asyncio
from datetime import datetime

from scraping_service.base import FeedbackItem
from scraping_service.core.exceptions import RateLimitError
from scraping_service.core.state import ScrapeStateStore
from scraping_service.facebook.scraper import FacebookScraper, deduplicate_feedback_items


def test_deduplicate_feedback_items_removes_duplicates():
    items = [
        FeedbackItem(
            source="facebook",
            source_id="c1",
            target_url="https://facebook.com/page",
            text="Premier commentaire",
            published_at=datetime(2025, 1, 1),
        ),
        FeedbackItem(
            source="facebook",
            source_id="c2",
            target_url="https://facebook.com/page",
            text="Deuxième commentaire",
            published_at=datetime(2025, 1, 2),
        ),
        FeedbackItem(
            source="facebook",
            source_id="c1",
            target_url="https://facebook.com/page",
            text="Premier commentaire",
            published_at=datetime(2025, 1, 1),
        ),
    ]

    result = deduplicate_feedback_items(items)

    assert len(result) == 2
    assert {item.source_id for item in result} == {"c1", "c2"}


def test_fetch_retries_transient_errors_before_success(monkeypatch, tmp_path):
    calls = {"page_posts": 0, "comments": 0}

    class FakeClient:
        async def fetch_page_posts(self, page_id: str, limit: int = 25):
            calls["page_posts"] += 1
            if calls["page_posts"] == 1:
                raise RateLimitError("rate limited")
            return [{"id": "post_1", "message": "hello"}]

        async def fetch_post_comments(self, post_id: str, max_comments: int = 100):
            calls["comments"] += 1
            return [
                {
                    "id": "comment_1",
                    "from": {"id": "user_1", "name": "Alice"},
                    "message": "Très bon avis",
                    "created_time": "2025-01-01T12:00:00+0000",
                    "permalink_url": "https://facebook.com/comment_1",
                }
            ]

    scraper = FacebookScraper(
        client=FakeClient(),
        state_store=ScrapeStateStore(path=tmp_path / "scrape_state.json"),
    )

    async def fake_sleep(delay):
        return None

    monkeypatch.setattr("scraping_service.facebook.scraper.asyncio.sleep", fake_sleep)

    async def _run():
        return await scraper.fetch("https://www.facebook.com/page-test", max_items=5)

    items = asyncio.run(_run())

    assert len(items) == 1
    assert items[0].source_id == "comment_1"
    assert calls["page_posts"] == 2


def test_export_csv_handles_empty_and_valid_data(tmp_path):
    from scripts.scrape_facebook import export_csv

    out_file = tmp_path / "export.csv"
    # Empty list returns False and creates no file
    assert export_csv([], out_file) is False
    assert not out_file.exists()

    # Valid data
    sample_data = [
        {
            "source_id": "c1",
            "published_at": "2025-01-01T12:00:00",
            "author_name": "Anonymous",
            "permalink": "https://facebook.com/c1",
            "text": "Great service",
            "target_url": "https://facebook.com/page",
            "rating": 5.0,
            "metadata": {"post_id": "post_100"},
        }
    ]
    assert export_csv(sample_data, out_file) is True
    assert out_file.exists()
    content = out_file.read_text(encoding="utf-8-sig")
    assert "source_id,published_at,author_name,permalink,text,target_url,rating,post_id" in content
    assert "c1" in content
    assert "post_100" in content


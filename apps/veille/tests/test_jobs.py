from datetime import datetime

from scraping_service.core.jobs import ScrapeJobTracker


def test_scrape_job_tracker_records_run_metadata(tmp_path):
    tracker = ScrapeJobTracker(path=tmp_path / "job_history.json")

    tracker.record_run(
        job_name="facebook_daily",
        target="page_42",
        count=3,
        status="success",
        started_at=datetime(2026, 10, 5, 8, 0, 0),
        finished_at=datetime(2026, 10, 5, 8, 0, 5),
    )

    history = tracker.load()
    assert len(history) == 1
    assert history[0]["job_name"] == "facebook_daily"
    assert history[0]["target"] == "page_42"
    assert history[0]["count"] == 3
    assert history[0]["status"] == "success"


def test_scrape_job_tracker_summary_reports_kpis(tmp_path):
    tracker = ScrapeJobTracker(path=tmp_path / "job_history.json")

    tracker.record_run("facebook_daily", "page_42", 10, "success")
    tracker.record_run("facebook_daily", "page_42", 0, "failed")
    tracker.record_run("facebook_daily", "page_42", 5, "success")

    report = tracker.summary(limit=10)

    assert report["total_runs"] == 3
    assert report["status_counts"]["success"] == 2
    assert report["status_counts"]["failed"] == 1
    assert report["success_rate"] == 0.67
    assert report["last_run"]["status"] == "success"
    assert report["last_run"]["count"] == 5

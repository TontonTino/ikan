import asyncio
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from scraping_service.ai.pipeline import AIPipeline, RuleBasedAIAnalyzer
from scraping_service.api import app
import scraping_service.api as api
from scraping_service.base import FeedbackItem
from scraping_service.config import settings
from scraping_service.core.feedback_store import FileFeedbackStore
from scraping_service.facebook.scraper import FacebookCollector, FacebookScraper


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def test_setup(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "api_key", "test-api-key")
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")
    monkeypatch.setattr(settings, "state_dir", tmp_path / "state")
    return {
        "client": TestClient(app),
        "data_dir": tmp_path / "data",
        "state_dir": tmp_path / "state",
    }


def test_rule_based_analyzer_sentiment():
    analyzer = RuleBasedAIAnalyzer()

    pos = run(analyzer.analyze("Service client rapide, super équipe et très professionnel !"))
    assert pos["sentiment"] == "positif"
    assert pos["theme"] == "service_client"
    assert pos["confidence"] >= 0.70

    neg = run(analyzer.analyze("C'est une arnaque horrible, produit décevant et bug permanent."))
    assert neg["sentiment"] == "négatif"
    assert neg["confidence"] >= 0.70

    neu = run(analyzer.analyze("Bonjour, pouvez-vous me donner les horaires d'ouverture ?"))
    assert neu["sentiment"] == "neutre"


def test_ai_pipeline_enriches_feedback_items():
    pipeline = AIPipeline()
    item = FeedbackItem(
        source="facebook",
        source_id="c_100",
        target_url="https://facebook.com/page",
        text="Application très facile et intuitive à utiliser !",
        published_at=datetime.now(timezone.utc),
    )

    enriched = run(pipeline.process_item(item))
    assert enriched.sentiment == "positif"
    assert enriched.theme == "experience_utilisateur"
    assert enriched.confidence is not None
    assert enriched.ai_analyzed_at is not None


def test_api_ai_analyze_endpoint(test_setup):
    client = test_setup["client"]
    store = FileFeedbackStore(test_setup["data_dir"], test_setup["state_dir"])

    store.append_new(
        "client-ai-test",
        "page-1",
        [
            FeedbackItem(
                source="facebook",
                source_id="comm_1",
                target_url="https://facebook.com/page",
                text="Super support client, réponse rapide !",
            ),
            FeedbackItem(
                source="facebook",
                source_id="comm_2",
                target_url="https://facebook.com/page",
                text="Prix beaucoup trop cher pour ce service décevant.",
            ),
        ],
    )

    headers = {"X-API-Key": "test-api-key"}
    response = client.post(
        "/ai/analyze",
        json={"client_id": "client-ai-test", "limit": 10},
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["client_id"] == "client-ai-test"
    assert data["count"] == 2
    assert data["items"][0]["sentiment"] == "positif"
    assert data["items"][0]["theme"] == "service_client"
    assert data["items"][1]["sentiment"] == "négatif"


def test_unified_facebook_collector_alias():
    assert FacebookCollector is FacebookScraper

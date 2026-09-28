"""Tests d'intégration pour les routes FastAPI du service de veille."""

import pytest
from starlette.testclient import TestClient

from scraping_service.api import app
from scraping_service.config import settings


@pytest.fixture
def client():
    return TestClient(app)


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "session_facebook" in data


def test_session_status_unauthorized(client):
    # Clé manquante
    response = client.get("/session/facebook/status")
    # Si settings.api_key est vide => 503, sinon si non fournie => 401
    assert response.status_code in {401, 503}


def test_session_status_authorized(client, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "secret-test-key")
    response = client.get("/session/facebook/status", headers={"X-API-Key": "secret-test-key"})
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "facebook"
    assert "valid" in data
    assert "message" in data


def test_scrape_validation_error(client, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "secret-test-key")
    # Mauvais domaine
    payload = {"target": "https://www.twitter.com/someuser", "max_items": 10}
    response = client.post("/scrape/facebook", json=payload, headers={"X-API-Key": "secret-test-key"})
    # Doit renvoyer une erreur 400 (TargetValidationError) ou 422 si Pydantic
    assert response.status_code in {400, 422}

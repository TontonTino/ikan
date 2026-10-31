"""
SD-02 côté agent YAM : le démarrage et Alembic refusent la base de production protégée hors APP_ENV=production.
Aucune base n'est touchée (adresses fictives, aucune connexion).

  python -m pytest tests_unit
"""
import os
import re
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-garde-prod-0123456789")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-garde-prod")

import pytest
from fastapi.testclient import TestClient

from app.config import garde_production as garde
from app.config.garde_production import ProductionProtegee, refuser_si_production
from app.config.settings import settings

ID_PROD = "slynbxonwureptrmuskn"          # identifiant public du projet de production (aucun secret)
MOT_DE_PASSE = "Motdepasse-Tres-Secret-42"
URL_PROD = f"postgresql://postgres.{ID_PROD}:{MOT_DE_PASSE}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"
URL_DEV = f"postgresql://postgres.abcdefghijklmnopqrst:{MOT_DE_PASSE}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"

RACINE = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _sans_autorisation(monkeypatch):
    monkeypatch.delenv(garde.VARIABLE_AUTORISATION, raising=False)


def test_production_refusee_sans_secret_dans_le_message():
    with pytest.raises(ProductionProtegee) as erreur:
        refuser_si_production(URL_PROD, "démarrage de l'agent YAM")
    message = str(erreur.value)
    assert "PRODUCTION" in message
    for interdit in (MOT_DE_PASSE, ID_PROD, "supabase", "@", "://"):
        assert interdit not in message


def test_developpement_accepte_et_production_deployee_jamais_bloquee():
    refuser_si_production(URL_DEV, "x")
    refuser_si_production(URL_PROD, "x", app_env="production")
    with pytest.raises(ProductionProtegee):
        refuser_si_production(URL_PROD, "x", app_env="development")


@pytest.mark.parametrize("valeur", ["1", "true", "OUI", "yes", ""])
def test_seul_oui_exact_autorise(monkeypatch, valeur):
    monkeypatch.setenv(garde.VARIABLE_AUTORISATION, valeur)
    with pytest.raises(ProductionProtegee):
        refuser_si_production(URL_PROD, "x")
    monkeypatch.setenv(garde.VARIABLE_AUTORISATION, "oui")
    refuser_si_production(URL_PROD, "x")


def test_l_agent_refuse_de_demarrer_en_developpement_contre_la_production(monkeypatch):
    from app.main import app

    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    with pytest.raises(ProductionProtegee):
        with TestClient(app):
            pass


def test_l_agent_demarre_en_production_et_sur_une_base_de_developpement(monkeypatch):
    from app.main import app

    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
    monkeypatch.setattr(settings, "DATABASE_URL", URL_DEV)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    with TestClient(app):
        pass


def test_alembic_de_l_agent_appelle_la_garde_avec_app_env():
    source = (RACINE / "alembic" / "env.py").read_text(encoding="utf8")
    assert re.search(r"refuser_si_production\([^)]*app_env=settings\.APP_ENV\)", source)

"""
Origines CORS : règle selon APP_ENV, variable explicite, normalisation, et requêtes OPTIONS
réelles (preflight) via le TestClient, sans base de données.

Le middleware est construit par app.core.cors.appliquer_cors, comme dans app.main : les tests
exercent donc la même configuration que la production.
"""
import os

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-cors-origines-tests-0123456789")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints import auth
from app.core.config import Settings
from app.core.cors import (
    ORIGINES_LOCALES,
    OriginesManquantes,
    appliquer_cors,
    normaliser_origines,
    origines_autorisees,
)

# Adresses d'exemple : aucune adresse de déploiement réelle n'est codée dans l'API (elles viennent de ALLOWED_ORIGINS).
DASHBOARD = "https://dashboard.exemple.org"
CLIENT = "https://client.exemple.org"
CONFIGUREES = f"{CLIENT},{DASHBOARD}"
LOCALHOST = "http://localhost:5173"
PREFLIGHT = "/api/v1/auth/login"


def _client(origines):
    app = FastAPI()
    appliquer_cors(app, origines)
    app.include_router(auth.router, prefix="/api/v1/auth")
    return TestClient(app)


def _preflight(client, origine):
    return client.options(PREFLIGHT, headers={
        "Origin": origine,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })


# ── Sans variable : développement = localhost, ailleurs = refus de démarrer ──────────

def test_sans_variable_en_production_refuse_de_demarrer_en_nommant_la_variable():
    for valeur in (None, "", " , ,"):
        with pytest.raises(OriginesManquantes, match="ALLOWED_ORIGINS"):
            origines_autorisees(valeur, "production")


def test_sans_variable_hors_development_refuse_aussi():
    with pytest.raises(OriginesManquantes):
        origines_autorisees(None, "staging")


def test_sans_variable_en_development_repli_sur_localhost_uniquement():
    origines = origines_autorisees(None, "development")
    assert origines == ORIGINES_LOCALES
    assert LOCALHOST in origines
    assert all(o.startswith("http://localhost") or o.startswith("http://127.0.0.1") for o in origines)


def test_aucune_adresse_de_deploiement_codee_dans_le_module():
    import app.core.cors as module
    source = open(module.__file__, encoding="utf-8").read()
    assert "onrender.com" not in source and "https://" not in source


def test_settings_applique_la_regle_selon_app_env():
    assert LOCALHOST in Settings(APP_ENV="development", ALLOWED_ORIGINS=None).allowed_origins_list
    with pytest.raises(OriginesManquantes):
        Settings(APP_ENV="production", ALLOWED_ORIGINS=None).allowed_origins_list
    assert Settings(APP_ENV="production", ALLOWED_ORIGINS=CONFIGUREES).allowed_origins_list == [CLIENT, DASHBOARD]


# ── Variable explicite : fait toujours foi ─────────────────────────

def test_variable_explicite_fait_foi_en_production():
    assert origines_autorisees("https://autre.example", "production") == ["https://autre.example"]


def test_variable_explicite_fait_foi_en_development():
    assert origines_autorisees("https://autre.example", "development") == ["https://autre.example"]


# ── Normalisation ────────────────────────────────────────────────────────────

def test_normalisation_espaces_virgules_vides_et_slash_final():
    brut = " https://a.example/ ,, ,https://b.example//, https://a.example "
    assert normaliser_origines(brut) == ["https://a.example", "https://b.example"]


# ── Requêtes OPTIONS réelles (TestClient, sans base) ─────────────────────────

def test_production_dashboard_et_client_acceptes():
    client = _client(origines_autorisees(CONFIGUREES, "production"))
    for origine in (DASHBOARD, CLIENT):
        r = _preflight(client, origine)
        assert r.status_code == 200, origine
        assert r.headers["access-control-allow-origin"] == origine


def test_production_refuse_origine_inconnue():
    client = _client(origines_autorisees(CONFIGUREES, "production"))
    for origine in ["https://inconnu.example", "https://ancien-nom.exemple.org"]:
        r = _preflight(client, origine)
        assert r.status_code == 400, origine
        assert "access-control-allow-origin" not in r.headers


def test_production_refuse_localhost():
    client = _client(origines_autorisees(CONFIGUREES, "production"))
    assert _preflight(client, LOCALHOST).status_code == 400


def test_development_accepte_localhost():
    client = _client(origines_autorisees(None, "development"))
    r = _preflight(client, LOCALHOST)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == LOCALHOST


def test_variable_avec_slash_final_est_reconnue_au_preflight():
    client = _client(origines_autorisees(f"{DASHBOARD}/", "production"))
    r = _preflight(client, DASHBOARD)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == DASHBOARD


# ── Câblage réel de app.main ─────────────────────────────────────────────────

def test_app_main_utilise_la_liste_configuree():
    from app.core.config import settings
    from app.main import app

    cors = [m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware"]
    assert len(cors) == 1
    assert cors[0].kwargs["allow_origins"] == settings.allowed_origins_list
    assert cors[0].kwargs["allow_credentials"] is True
    assert "*" not in cors[0].kwargs["allow_origins"]

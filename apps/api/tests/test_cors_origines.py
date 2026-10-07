"""
Origines CORS : défaut selon APP_ENV, variable explicite, normalisation, et requêtes OPTIONS
réelles (preflight) via le TestClient, sans base de données.

Le middleware est construit par app.core.cors.appliquer_cors, comme dans app.main : les tests
exercent donc la même configuration que la production.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-cors-origines-tests-0123456789")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints import auth
from app.core.config import Settings
from app.core.cors import (
    ORIGINES_LOCALES,
    ORIGINES_PRODUCTION,
    appliquer_cors,
    defaut_allowed_origins,
    normaliser_origines,
    origines_autorisees,
)

DASHBOARD = "https://ikanai-dashboard-fixs.onrender.com"
CLIENT = "https://ikan-1.onrender.com"
ANCIENS_NOMS = ["https://ikanai-client.onrender.com", "https://ikanai-dashboard.onrender.com"]
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


# ── Défaut selon APP_ENV ─────────────────────────────────────────────────────

def test_defaut_production_ne_contient_que_client_et_dashboard():
    assert defaut_allowed_origins("production") == f"{CLIENT},{DASHBOARD}"
    assert origines_autorisees(None, "production") == [CLIENT, DASHBOARD]


def test_defaut_production_refuse_les_localhost():
    origines = origines_autorisees(None, "production")
    assert not any(o in origines for o in ORIGINES_LOCALES)


def test_defaut_development_ajoute_les_localhost_aux_deux_origines_de_production():
    origines = origines_autorisees(None, "development")
    assert origines == ORIGINES_LOCALES + ORIGINES_PRODUCTION
    assert LOCALHOST in origines


def test_defaut_ne_cite_jamais_les_anciens_noms():
    for app_env in ("development", "production"):
        origines = origines_autorisees(None, app_env)
        assert not any(ancien in origines for ancien in ANCIENS_NOMS)


def test_settings_applique_le_defaut_selon_app_env():
    assert Settings(APP_ENV="production", ALLOWED_ORIGINS=None).allowed_origins_list == [CLIENT, DASHBOARD]
    assert LOCALHOST in Settings(APP_ENV="development", ALLOWED_ORIGINS=None).allowed_origins_list


# ── Variable explicite : remplace toujours le défaut ─────────────────────────

def test_variable_explicite_remplace_le_defaut_en_production():
    assert origines_autorisees("https://autre.example", "production") == ["https://autre.example"]


def test_variable_explicite_remplace_le_defaut_en_development():
    assert origines_autorisees("https://autre.example", "development") == ["https://autre.example"]


def test_variable_vide_ou_sans_origine_utilise_le_defaut():
    assert origines_autorisees("", "production") == [CLIENT, DASHBOARD]
    assert origines_autorisees(" , ,", "production") == [CLIENT, DASHBOARD]


# ── Normalisation ────────────────────────────────────────────────────────────

def test_normalisation_espaces_virgules_vides_et_slash_final():
    brut = " https://a.example/ ,, ,https://b.example//, https://a.example "
    assert normaliser_origines(brut) == ["https://a.example", "https://b.example"]


# ── Requêtes OPTIONS réelles (TestClient, sans base) ─────────────────────────

def test_production_dashboard_et_client_acceptes():
    client = _client(origines_autorisees(None, "production"))
    for origine in (DASHBOARD, CLIENT):
        r = _preflight(client, origine)
        assert r.status_code == 200, origine
        assert r.headers["access-control-allow-origin"] == origine


def test_production_refuse_origine_inconnue_et_anciens_noms():
    client = _client(origines_autorisees(None, "production"))
    for origine in ["https://inconnu.example", *ANCIENS_NOMS]:
        r = _preflight(client, origine)
        assert r.status_code == 400, origine
        assert "access-control-allow-origin" not in r.headers


def test_production_refuse_localhost():
    client = _client(origines_autorisees(None, "production"))
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

"""
Accès au module Veille (apps/veille) réservé au CX Manager : Agency Manager et
Admin doivent recevoir un 403 explicite sur les 3 endpoints, et un CX Manager
ne doit jamais pouvoir cibler une agence hors de sa propre organisation (via
verifier_acces_agence, AVANT toute écriture). Tests unitaires sans base ni
réseau réels — aucun appel Facebook, aucune écriture persistée ; la
vérification de bout en bout (vraie base, vrais comptes, avant/après) est
décrite dans le rapport.
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-veille-access-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import veille
from app.db.session import get_db
from app.models.enums import UserRole


class _Query:
    def __init__(self, first=None):
        self._first = first

    def filter(self, *a, **k):
        return self

    def first(self):
        return self._first


class _DbInterdite:
    """query(...) lève : prouve que le 403 tombe AVANT tout accès à la base."""
    def __getattr__(self, nom):
        raise AssertionError(f"Accès base de données ({nom}) avant le refus du rôle : le garde doit répondre AVANT")


class _DbAgence:
    """query(Agence) renvoie une agence fixe ; add()/commit() lèvent — prouve qu'aucune
    écriture (donc aucun feedback) n'a lieu quand verifier_acces_agence refuse."""
    def __init__(self, agence):
        self.agence = agence

    def query(self, *a, **k):
        return _Query(first=self.agence)

    def add(self, *a, **k):
        raise AssertionError("db.add() appelé : un feedback a été créé alors que l'accès aurait dû être refusé")

    def commit(self, *a, **k):
        raise AssertionError("db.commit() appelé : une écriture a eu lieu alors que l'accès aurait dû être refusé")


def _cx_manager(org_id):
    return SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=org_id)


def _agency_manager():
    return SimpleNamespace(id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True, agence_id=uuid4(), organisation_id=uuid4())


def _admin():
    return SimpleNamespace(id=uuid4(), role=UserRole.ADMIN, active=True, agence_id=None, organisation_id=uuid4())


def _client(user, db):
    app = FastAPI()
    app.include_router(veille.router, prefix="/veille")
    app.dependency_overrides[get_current_active_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


# ── Rôle : seul le CX Manager passe le garde (Agency Manager et Admin refusés) ──

@pytest.mark.parametrize("user_factory", [_agency_manager, _admin])
def test_status_refuse_hors_cx_manager(user_factory):
    client = _client(user_factory(), _DbInterdite())
    res = client.get("/veille/status")
    assert res.status_code == 403
    assert res.json()["detail"] == "Accès réservé aux CX Managers"


@pytest.mark.parametrize("user_factory", [_agency_manager, _admin])
def test_scrape_refuse_hors_cx_manager(user_factory, monkeypatch):
    monkeypatch.setattr(veille, "trigger_facebook_scrape", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("trigger_facebook_scrape appelé alors que le rôle aurait dû être refusé avant")
    ))
    client = _client(user_factory(), _DbInterdite())
    res = client.post("/veille/facebook/scrape", json={"target": "https://facebook.com/exemple"})
    assert res.status_code == 403
    assert res.json()["detail"] == "Accès réservé aux CX Managers"


@pytest.mark.parametrize("user_factory", [_agency_manager, _admin])
def test_ingest_refuse_hors_cx_manager(user_factory):
    client = _client(user_factory(), _DbInterdite())
    res = client.post("/veille/ingest", json={"agence_id": str(uuid4()), "items": []})
    assert res.status_code == 403
    assert res.json()["detail"] == "Accès réservé aux CX Managers"


def test_status_cx_manager_passe_le_garde_de_role(monkeypatch):
    # Le rôle passe ; on neutralise les appels réseau vers le microservice (hors périmètre RBAC).
    async def _fake_health():
        return {"status": "offline", "error": "microservice non lancé (test)"}

    monkeypatch.setattr(veille, "check_veille_service", _fake_health)
    client = _client(_cx_manager(uuid4()), _DbInterdite())
    res = client.get("/veille/status")
    assert res.status_code != 403
    assert res.status_code == 200
    assert res.json()["service"]["status"] == "offline"


# ── Cloisonnement par organisation : verifier_acces_agence AVANT toute écriture ──

def test_ingest_cx_manager_refuse_agence_d_une_autre_organisation(monkeypatch):
    monkeypatch.setattr(veille, "ingest_mentions", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("ingest_mentions appelé : l'accès aurait dû être refusé avant toute ingestion")
    ))
    agence_autre_org = SimpleNamespace(id=uuid4(), organisation_id=uuid4())
    user = _cx_manager(uuid4())  # organisation différente de celle de l'agence ciblée
    client = _client(user, _DbAgence(agence_autre_org))
    res = client.post("/veille/ingest", json={"agence_id": str(agence_autre_org.id), "items": [{"text": "avis test"}]})
    assert res.status_code == 403
    assert "organisation" in res.json()["detail"]


def test_scrape_auto_ingest_cx_manager_refuse_agence_d_une_autre_organisation(monkeypatch):
    async def _fake_scrape(*a, **k):
        return {"success": True, "data": {"items": [{"text": "avis test"}]}}

    monkeypatch.setattr(veille, "trigger_facebook_scrape", _fake_scrape)
    monkeypatch.setattr(veille, "ingest_mentions", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("ingest_mentions appelé : l'accès aurait dû être refusé avant toute ingestion")
    ))
    agence_autre_org = SimpleNamespace(id=uuid4(), organisation_id=uuid4())
    user = _cx_manager(uuid4())
    client = _client(user, _DbAgence(agence_autre_org))
    res = client.post(
        "/veille/facebook/scrape",
        json={"target": "https://facebook.com/exemple", "agence_id": str(agence_autre_org.id), "auto_ingest": True},
    )
    assert res.status_code == 403
    assert "organisation" in res.json()["detail"]


def test_ingest_cx_manager_accede_a_une_agence_de_sa_propre_organisation(monkeypatch):
    # Le garde d'organisation laisse passer ; on neutralise l'ingestion elle-même (hors périmètre RBAC,
    # et pour ne déclencher aucune écriture réelle dans ce test unitaire).
    monkeypatch.setattr(veille, "ingest_mentions", lambda *a, **k: {"ingested_count": 0, "duplicate_count": 0, "ignored_empty_count": 0})
    org = uuid4()
    ma_agence = SimpleNamespace(id=uuid4(), organisation_id=org)
    user = _cx_manager(org)
    client = _client(user, _DbAgence(ma_agence))
    res = client.post("/veille/ingest", json={"agence_id": str(ma_agence.id), "items": []})
    assert res.status_code == 200

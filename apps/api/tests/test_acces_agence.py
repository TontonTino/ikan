"""
Isolation par agence pour l'Agency Manager (et par organisation pour le CX Manager) :
un identifiant d'agence/ressource manipulé à la main ne doit JAMAIS donner accès aux
données d'une autre agence. Tests unitaires sans base réelle ; la vérification
de bout en bout (vraie base, vrais comptes) est décrite dans le rapport.
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-acces-agence-tests-0123456789")

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import agences, dashboard, recommandations
from app.db.session import get_db
from app.models.enums import UserRole
from app.services.acces_agence import verifier_acces_agence


class _Query:
    def __init__(self, first=None, rows=None):
        self._first, self._rows = first, rows or []

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def first(self):
        return self._first

    def all(self):
        return self._rows


class _Db:
    """query(...) renvoie toujours la même agence (ou None) — suffit aux gardes d'accès."""
    def __init__(self, agence=None):
        self.agence = agence

    def query(self, *a, **k):
        return _Query(first=self.agence)


def _agency_manager(agence_id):
    return SimpleNamespace(id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True,
                           agence_id=agence_id, organisation_id=uuid4())


def _cx_manager(org_id):
    return SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True,
                           agence_id=None, organisation_id=org_id)


# ── helper ────────────────────────────────────────────────────────────────────

def test_agency_manager_accede_a_sa_propre_agence():
    mon_agence = uuid4()
    verifier_acces_agence(_Db(), _agency_manager(mon_agence), mon_agence)  # ne lève pas


@pytest.mark.parametrize("cible", [None, "autre"])
def test_agency_manager_refuse_hors_de_son_agence(cible):
    user = _agency_manager(uuid4())
    with pytest.raises(HTTPException) as exc:
        verifier_acces_agence(_Db(), user, uuid4() if cible else None)
    assert exc.value.status_code == 403


def test_cx_manager_accede_aux_agences_de_son_organisation():
    org = uuid4()
    agence = SimpleNamespace(id=uuid4(), organisation_id=org)
    verifier_acces_agence(_Db(agence), _cx_manager(org), agence.id)  # ne lève pas


def test_cx_manager_refuse_agence_d_une_autre_organisation():
    agence_autre_org = SimpleNamespace(id=uuid4(), organisation_id=uuid4())
    with pytest.raises(HTTPException) as exc:
        verifier_acces_agence(_Db(agence_autre_org), _cx_manager(uuid4()), agence_autre_org.id)
    assert exc.value.status_code == 403


def test_cx_manager_refuse_agence_inexistante():
    with pytest.raises(HTTPException) as exc:
        verifier_acces_agence(_Db(None), _cx_manager(uuid4()), uuid4())
    assert exc.value.status_code == 403


# ── endpoints : identifiant d'agence manipulé dans l'URL ──────────────────────

def _client(router, prefix, user, db=None):
    app = FastAPI()
    app.include_router(router, prefix=prefix)
    app.dependency_overrides[get_current_active_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: (db if db is not None else _Db())
    # get_cx_or_agency_manager / get_cx_or_admin dépendent de get_current_active_user
    return TestClient(app)


def test_dashboard_agence_refuse_autre_agence():
    user = _agency_manager(uuid4())
    client = _client(dashboard.router, "/dashboard", user)
    assert client.get(f"/dashboard/agence/{uuid4()}").status_code == 403


def test_recommandations_agence_refuse_autre_agence():
    user = _agency_manager(uuid4())
    client = _client(recommandations.router, "/recommandations", user)
    assert client.get(f"/recommandations/agences/{uuid4()}").status_code == 403


def test_categories_lecture_agency_manager_refuse_autre_agence():
    user = _agency_manager(uuid4())
    autre = SimpleNamespace(id=uuid4(), organisation_id=uuid4())
    client = _client(agences.router, "/agences", user, _Db(autre))
    assert client.get(f"/agences/{autre.id}/categories").status_code == 403


def test_categories_creation_agency_manager_interdite_hors_de_sa_propre_agence():
    """
    L'Agency Manager peut désormais créer ses propres catégories, mais UNIQUEMENT sur SA
    PROPRE agence : un identifiant d'agence manipulé dans l'URL (une autre agence que la
    sienne) reste refusé — 403, comme pour tous les autres endpoints agence de ce fichier.
    La matrice complète des permissions par créateur (qui peut modifier/désactiver quoi)
    est testée avec une vraie base dans test_categories_permissions.py.
    """
    autre_agence = uuid4()
    user = _agency_manager(uuid4())  # rattaché à une agence différente de `autre_agence`
    cible = SimpleNamespace(id=autre_agence, organisation_id=uuid4())
    client = _client(agences.router, "/agences", user, _Db(cible))
    assert client.post(f"/agences/{autre_agence}/categories", json={"nom": "Intrusion"}).status_code == 403

"""
Principe RBAC fondateur : l'Admin n'a JAMAIS accès aux données clients (feedbacks,
suggestions, alertes, recommandations, analyses IA, demandes de contact, statistiques
de satisfaction d'un réseau) — uniquement à la vue structurelle. Toute tentative doit
recevoir un 403 explicite (ni liste vide silencieuse, ni données).

Le test PARCOURT DYNAMIQUEMENT toutes les routes des routeurs de données clients :
un endpoint ajouté demain sans le bon garde fera échouer ce test immédiatement.
La base est un faux qui LÈVE si on l'interroge : le 403 doit tomber AVANT tout accès aux données.
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-admin-exclu-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.deps import get_cx_manager, get_cx_or_agency_manager, get_current_active_user, get_feedback_viewer_user
from app.api.v1.endpoints import alertes, analyses, dashboard, feedbacks, recommandations, suggestions
from app.db.session import get_db
from app.models.enums import UserRole

# (préfixe, routeur)
ROUTEURS_DONNEES_CLIENT = [
    ("/feedbacks", feedbacks.router),
    ("/suggestions", suggestions.router),
    ("/recommandations", recommandations.router),
    ("/alertes", alertes.router),
    ("/analyses", analyses.router),
    ("/dashboard", dashboard.router),
]

# Exceptions LÉGITIMES, explicitement justifiées :
AUTORISEES_POUR_ADMIN = {
    ("/dashboard", "/admin"),                          # dashboard structurel de l'Admin
    ("/dashboard", "/statistics/admin"),               # statistiques plateforme de l'Admin
    ("/alertes", "/agences/{agence_id}/seuil"),        # configuration des seuils (droit structurel, matrice des permissions)
}
PUBLICS = {("/feedbacks", "POST", "/")}                # soumission d'un feedback par le client final (sans compte)


class _DbInterdite:
    def __getattr__(self, nom):
        raise AssertionError(f"Accès base de données ({nom}) avant le refus de l'Admin : le garde doit répondre AVANT")


def _admin():
    return SimpleNamespace(id=uuid4(), role=UserRole.ADMIN, active=True, agence_id=None, organisation_id=uuid4())


def _routes_a_tester():
    cas = []
    for prefixe, routeur in ROUTEURS_DONNEES_CLIENT:
        for route in routeur.routes:
            if not isinstance(route, APIRoute):
                continue
            for methode in sorted(route.methods - {"HEAD", "OPTIONS"}):
                if (prefixe, route.path) in AUTORISEES_POUR_ADMIN or (prefixe, methode, route.path) in PUBLICS:
                    continue
                cas.append((prefixe, routeur, methode, route.path))
    return cas


def _url(prefixe, chemin):
    remplace = chemin
    while "{" in remplace:
        debut, fin = remplace.index("{"), remplace.index("}")
        remplace = remplace[:debut] + str(uuid4()) + remplace[fin + 1:]
    return prefixe + remplace


def _client(routeur, prefixe, user):
    app = FastAPI()
    app.include_router(routeur, prefix=prefixe)
    app.dependency_overrides[get_current_active_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: _DbInterdite()
    return TestClient(app)


CAS = _routes_a_tester()


def test_le_parcours_couvre_bien_tous_les_endpoints_de_donnees_clients():
    # garde-fou : si le parcours devenait vide (refactor des routeurs), ce test ne doit pas passer "dans le vide"
    # 24 aujourd'hui : 12 feedbacks + 3 suggestions + 3 recommandations + 1 alerte + 1 analyse + 4 dashboard
    assert len(CAS) >= 24, f"seulement {len(CAS)} routes parcourues : le parcours dynamique est cassé"


@pytest.mark.parametrize("prefixe,routeur,methode,chemin", CAS, ids=[f"{m} {p}{c}" for p, _, m, c in CAS])
def test_admin_recoit_403_explicite(prefixe, routeur, methode, chemin):
    client = _client(routeur, prefixe, _admin())
    reponse = client.request(methode, _url(prefixe, chemin), json={})
    assert reponse.status_code == 403, f"{methode} {prefixe}{chemin} -> {reponse.status_code} (attendu 403)"
    assert reponse.json().get("detail"), "le 403 doit être explicite (message)"


# ── gardes eux-mêmes ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", [UserRole.CX_MANAGER, UserRole.AGENCY_MANAGER])
def test_gardes_laissent_passer_cx_et_agency(role):
    user = SimpleNamespace(id=uuid4(), role=role, active=True)
    assert get_cx_or_agency_manager(user) is user
    assert get_feedback_viewer_user(user) is user


def test_garde_cx_or_agency_exclut_l_admin():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        get_cx_or_agency_manager(_admin())
    assert exc.value.status_code == 403
    assert "Administrateur" in exc.value.detail


def test_dashboard_siege_et_statistiques_cx_refusent_agency_manager_aussi():
    agency = SimpleNamespace(id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True, agence_id=uuid4(), organisation_id=uuid4())
    client = _client(dashboard.router, "/dashboard", agency)
    assert client.get("/dashboard/siege").status_code == 403
    assert client.get("/dashboard/statistics/cx").status_code == 403


def test_garde_cx_manager_refuse_admin():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        get_cx_manager(_admin())
    assert exc.value.status_code == 403

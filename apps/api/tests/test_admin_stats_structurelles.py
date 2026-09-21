"""
Principe RBAC fondateur : l'Admin n'a AUCUN accès aux données clients ni aux statistiques de
satisfaction — vue structurelle uniquement (comptes, organisations, agences, forfaits).

/dashboard/admin et /dashboard/statistics/admin ne doivent donc renvoyer AUCUN champ dérivé des
feedbacks (volume, satisfaction, traitement, alertes, tendances, sentiments, usage IA…), à aucun
niveau d'agrégation. Ce sont des tests de CONTENU (pas seulement de statut) :

1. la base de test ne contient QUE les tables structurelles : les tables de feedbacks n'existent
   pas, donc toute requête dessus ferait planter l'endpoint ;
2. les clés du JSON réel sont comparées à une liste blanche exacte ET à une liste de mots interdits ;
3. les schémas de réponse eux-mêmes sont parcourus récursivement (couvre aussi les listes vides).
"""
import os
import re
import typing
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-admin-stats-structurelles-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import dashboard
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.schemas.dashboard import DashboardAdminStats, StatsAdminResponse
from app.services.plan_catalog import PLANS

# Mots interdits dans les NOMS de champs ET dans les libellés renvoyés.
INTERDITS = re.compile(
    r"feedback|satisf|sentiment|traite|traitement|discordance|suggestion|analyse|volume|critique|"
    r"nlp|requetes?_ia|utilisation_ia|activity|(?<!secteur_)activite|tendance|trend|evolution|periode|score|note",
    re.IGNORECASE,
)
# Seule exception : un RÉGLAGE configuré par l'Admin (droit structurel), pas une donnée dérivée.
AUTORISES = {"seuil_alerte"}

CLES_DASHBOARD = {
    "total_organisations", "total_agences", "total_cx_managers", "total_agency_managers",
    "total_utilisateurs_actifs", "repartition_forfaits", "organisations_overview",
}
CLES_STATS = {"kpis", "repartition_forfaits", "organisations"}
CLES_KPIS = {"organisations_actives", "total_agences", "utilisateurs_actifs", "cx_managers", "agency_managers"}
CLES_ORG_STATS = {"organisation_id", "nom", "logo", "secteur", "agences_count", "utilisateurs_count", "plan_code", "plan_nom"}
CLES_ORG_OVERVIEW = {
    "id", "nom", "logo", "secteur_activite", "pays_region", "email_pro", "active", "created_at",
    "plan_code", "plan_nom", "cx_managers_count", "agency_managers_count", "agences_count",
    "cx_managers", "agency_managers", "agences", "users",
}
CLES_USER = {"id", "nom", "prenom", "email", "role", "agence_nom", "agences_count", "active", "derniere_connexion"}
CLES_AGENCE = {"id", "nom", "ville", "adresse", "active", "seuil_alerte"}


@pytest.fixture()
def client():
    """SQLite mémoire avec UNIQUEMENT les tables structurelles (pas de feedbacks, analyses, etc.)."""
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine, tables=[Plan.__table__, Organisation.__table__, Agence.__table__, Utilisateur.__table__]
    )
    Session = sessionmaker(bind=engine)

    db = Session()
    for code, (pid, nom, ordre, cx, ag, fb) in PLANS.items():
        db.add(Plan(id=pid, code=code, nom=nom, ordre=ordre, max_cx_managers=cx, max_agences=ag, max_feedbacks_mois=fb))
    db.commit()

    org_a = Organisation(id=uuid4(), nom="Org A", plan_id=PLANS["starter"][0], active=True)
    org_b = Organisation(id=uuid4(), nom="Org B", plan_id=PLANS["gratuit"][0], active=True)
    org_off = Organisation(id=uuid4(), nom="Org Inactive", plan_id=PLANS["pro"][0], active=False)
    db.add_all([org_a, org_b, org_off])
    db.commit()

    ag1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence 1", active=True)
    ag2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence 2", active=True)
    ag3 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence 3", active=True)
    db.add_all([ag1, ag2, ag3])
    db.commit()

    def user(org, role, email, agence=None, actif=True):
        return Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None,
                           nom="N", prenom="P", email=email, mot_de_passe_hash="x", role=role, active=actif)

    db.add_all([
        user(org_a, UserRole.CX_MANAGER, "cx.a@test.bf"),
        user(org_a, UserRole.AGENCY_MANAGER, "am.a@test.bf", ag1),
        user(org_b, UserRole.CX_MANAGER, "cx.b@test.bf"),
        user(org_b, UserRole.AGENCY_MANAGER, "am.b.inactif@test.bf", ag3, actif=False),
    ])
    db.commit()
    org_a_id = org_a.id
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(dashboard.router, prefix="/dashboard")
    admin = SimpleNamespace(id=uuid4(), role=UserRole.ADMIN, active=True, agence_id=None, organisation_id=org_a_id)
    app.dependency_overrides[get_current_active_user] = lambda: admin
    app.dependency_overrides[get_db] = _db
    return TestClient(app)


def _cles_recursives(objet):
    """Toutes les clés de tous les dictionnaires imbriqués d'un JSON."""
    if isinstance(objet, dict):
        for cle, valeur in objet.items():
            yield cle
            yield from _cles_recursives(valeur)
    elif isinstance(objet, list):
        for element in objet:
            yield from _cles_recursives(element)


def _chaines_recursives(objet):
    if isinstance(objet, dict):
        for valeur in objet.values():
            yield from _chaines_recursives(valeur)
    elif isinstance(objet, list):
        for element in objet:
            yield from _chaines_recursives(element)
    elif isinstance(objet, str):
        yield objet


def _verifier_aucun_interdit(json_reponse):
    for cle in _cles_recursives(json_reponse):
        if cle in AUTORISES:
            continue
        assert not INTERDITS.search(cle), f"champ interdit (dérivé des feedbacks/satisfaction) dans la réponse : '{cle}'"
    for texte in _chaines_recursives(json_reponse):
        assert not INTERDITS.search(texte), f"libellé interdit dans la réponse : '{texte}'"


# ── /dashboard/admin ──────────────────────────────────────────────────────────

def test_dashboard_admin_contenu_strictement_structurel(client):
    r = client.get("/dashboard/admin")
    assert r.status_code == 200
    data = r.json()

    assert set(data.keys()) == CLES_DASHBOARD, f"clés inattendues : {set(data.keys()) ^ CLES_DASHBOARD}"
    _verifier_aucun_interdit(data)

    org = data["organisations_overview"][0]
    assert set(org.keys()) == CLES_ORG_OVERVIEW
    for u in org["users"]:
        assert set(u.keys()) == CLES_USER
    for a in org["agences"]:
        assert set(a.keys()) == CLES_AGENCE


def test_dashboard_admin_compteurs_structurels_corrects(client):
    data = client.get("/dashboard/admin").json()
    assert data["total_organisations"] == 2          # l'organisation inactive n'est pas comptée
    assert data["total_agences"] == 3
    assert data["total_cx_managers"] == 2            # (avant : comptait TOUS les utilisateurs actifs)
    assert data["total_agency_managers"] == 1        # l'Agency Manager inactif n'est pas compté
    assert data["total_utilisateurs_actifs"] == 3
    repartition = {r["code"]: r["nombre"] for r in data["repartition_forfaits"]}
    assert repartition == {"gratuit": 1, "starter": 1, "pro": 0, "entreprise": 0}


# ── /dashboard/statistics/admin ───────────────────────────────────────────────

def test_statistics_admin_contenu_strictement_structurel(client):
    r = client.get("/dashboard/statistics/admin")
    assert r.status_code == 200
    data = r.json()

    assert set(data.keys()) == CLES_STATS, f"clés inattendues : {set(data.keys()) ^ CLES_STATS}"
    assert set(data["kpis"].keys()) == CLES_KPIS
    _verifier_aucun_interdit(data)
    for org in data["organisations"]:
        assert set(org.keys()) == CLES_ORG_STATS


def test_statistics_admin_compteurs_structurels_corrects(client):
    data = client.get("/dashboard/statistics/admin").json()
    assert data["kpis"]["organisations_actives"]["valeur"] == 2
    assert data["kpis"]["total_agences"]["valeur"] == 3
    assert data["kpis"]["utilisateurs_actifs"]["valeur"] == 3
    orgs = {o["nom"]: o for o in data["organisations"]}
    assert orgs["Org A"]["agences_count"] == 2 and orgs["Org A"]["utilisateurs_count"] == 2
    assert orgs["Org A"]["plan_code"] == "starter"


def test_statistics_admin_ignore_l_ancien_parametre_jours(client):
    # Les anciens clients envoyaient ?jours=30 : ignoré, aucune erreur, aucune donnée temporelle.
    r = client.get("/dashboard/statistics/admin?jours=30")
    assert r.status_code == 200
    assert "periode_jours" not in r.json() and "evolution_volume" not in r.json()


# ── schémas de réponse (couvre aussi les listes vides que le JSON ne montre pas) ─

def _champs_du_schema(modele, vus=None):
    vus = vus if vus is not None else set()
    if modele in vus:
        return
    vus.add(modele)
    for nom, info in modele.model_fields.items():
        yield nom
        yield from _modeles_imbriques(info.annotation, vus)


def _modeles_imbriques(annotation, vus):
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        yield from _champs_du_schema(annotation, vus)
    for arg in typing.get_args(annotation):
        yield from _modeles_imbriques(arg, vus)


@pytest.mark.parametrize("schema", [DashboardAdminStats, StatsAdminResponse])
def test_schemas_de_reponse_sans_champ_lie_aux_feedbacks(schema):
    champs = list(_champs_du_schema(schema))
    assert len(champs) > 10, "le parcours du schéma est vide : test invalide"
    for champ in champs:
        if champ in AUTORISES:
            continue
        assert not INTERDITS.search(champ), f"{schema.__name__} contient le champ interdit '{champ}'"

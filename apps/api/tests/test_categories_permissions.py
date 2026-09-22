"""
Catégories de feedback par agence : l'Agency Manager peut désormais créer SES PROPRES
catégories sur SA PROPRE agence, mais ne peut modifier/désactiver QUE celles qu'il a
lui-même créées — jamais celles du CX Manager, même sur sa propre agence. Le CX Manager,
lui, garde tous ses droits sur les agences de son organisation, quel que soit le créateur
(pas de régression).

Base de test : SQLite en mémoire, uniquement les tables nécessaires. Le gate de
fonctionnalité (forfait Starter+) est neutralisé par monkeypatch : hors périmètre de ce
test, qui porte exclusivement sur les permissions par créateur.
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-categories-permissions-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import agences
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx(monkeypatch):
    # Gate « forfait Starter+ » neutralisé : hors périmètre de ce test.
    monkeypatch.setattr(agences, "organisation_a_la_fonctionnalite", lambda *a, **kw: True)

    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine, tables=[Plan.__table__, Organisation.__table__, Agence.__table__, Utilisateur.__table__, Categorie.__table__]
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org = Organisation(id=uuid4(), nom="Org Test", active=True)
    db.add(org)
    db.flush()

    ag_a = Agence(id=uuid4(), organisation_id=org.id, nom="Agence A", active=True)
    ag_b = Agence(id=uuid4(), organisation_id=org.id, nom="Agence B", active=True)
    db.add_all([ag_a, ag_b])
    db.flush()

    cx = Utilisateur(id=uuid4(), organisation_id=org.id, nom="N", prenom="CX", email="cx@test.bf",
                      mot_de_passe_hash="x", role=UserRole.CX_MANAGER, active=True)
    am_a = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=ag_a.id, nom="N", prenom="AM-A", email="ama@test.bf",
                        mot_de_passe_hash="x", role=UserRole.AGENCY_MANAGER, active=True)
    am_b = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=ag_b.id, nom="N", prenom="AM-B", email="amb@test.bf",
                        mot_de_passe_hash="x", role=UserRole.AGENCY_MANAGER, active=True)
    db.add_all([cx, am_a, am_b])
    db.flush()

    cat_cx = Categorie(id=uuid4(), agence_id=ag_a.id, nom="Accueil (CX)", active=True,
                        cree_par_id=cx.id, cree_par_role="cx_manager")
    db.add(cat_cx)
    db.commit()

    org_id = org.id
    ag_a_id, ag_b_id = ag_a.id, ag_b.id
    cx_id, am_a_id, am_b_id = cx.id, am_a.id, am_b.id
    cat_cx_id = cat_cx.id
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(agences.router, prefix="/agences")
    app.dependency_overrides[get_db] = _db

    def client_pour(role, user_id, agence_id=None):
        user = SimpleNamespace(id=user_id, role=role, active=True, agence_id=agence_id, organisation_id=org_id)
        app.dependency_overrides[get_current_active_user] = lambda: user
        return TestClient(app)

    return SimpleNamespace(
        client_pour=client_pour,
        ag_a=ag_a_id, ag_b=ag_b_id,
        cx=cx_id, am_a=am_a_id, am_b=am_b_id,
        cat_cx=cat_cx_id,
    )


# ── Création ────────────────────────────────────────────────────────────────

def test_agency_manager_peut_creer_une_categorie_sur_sa_propre_agence(ctx):
    c = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_a, ctx.ag_a)
    r = c.post(f"/agences/{ctx.ag_a}/categories", json={"nom": "Propreté"})
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["nom"] == "Propreté"
    assert data["cree_par_id"] == str(ctx.am_a)
    assert data["cree_par_role"] == "agency_manager"


def test_agency_manager_ne_peut_pas_creer_sur_une_autre_agence(ctx):
    c = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_a, ctx.ag_a)
    r = c.post(f"/agences/{ctx.ag_b}/categories", json={"nom": "Intrusion"})
    assert r.status_code == 403
    assert r.json().get("detail")


def test_cx_manager_peut_toujours_creer_sur_une_agence_de_son_organisation(ctx):
    c = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx)
    r = c.post(f"/agences/{ctx.ag_b}/categories", json={"nom": "Tarifs"})
    assert r.status_code == 201, r.text
    assert r.json()["cree_par_role"] == "cx_manager"


# ── Modification / désactivation ──────────────────────────────────────────────

def test_agency_manager_peut_modifier_et_desactiver_sa_propre_categorie(ctx):
    c = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_a, ctx.ag_a)
    creee = c.post(f"/agences/{ctx.ag_a}/categories", json={"nom": "Formation"}).json()

    r = c.patch(f"/agences/{ctx.ag_a}/categories/{creee['id']}", json={"nom": "Formation client"})
    assert r.status_code == 200, r.text
    assert r.json()["nom"] == "Formation client"

    r = c.delete(f"/agences/{ctx.ag_a}/categories/{creee['id']}")
    assert r.status_code == 204


def test_agency_manager_ne_peut_pas_modifier_une_categorie_du_cx_manager(ctx):
    """Test de sécurité explicite : même sur SA PROPRE agence, l'Agency Manager ne peut
    pas toucher à une catégorie créée par le CX Manager — 403, aucun état modifié."""
    c = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_a, ctx.ag_a)

    r = c.patch(f"/agences/{ctx.ag_a}/categories/{ctx.cat_cx}", json={"nom": "Piraté"})
    assert r.status_code == 403
    assert r.json().get("detail")

    r = c.delete(f"/agences/{ctx.ag_a}/categories/{ctx.cat_cx}")
    assert r.status_code == 403

    # Vérifie qu'aucun état n'a été modifié malgré les tentatives.
    c_cx = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx)
    encore = c_cx.get(f"/agences/{ctx.ag_a}/categories").json()
    cible = next(x for x in encore if x["id"] == str(ctx.cat_cx))
    assert cible["nom"] == "Accueil (CX)"
    assert cible["active"] is True


def test_agency_manager_ne_peut_pas_modifier_une_categorie_d_une_autre_agence(ctx):
    c_a = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_a, ctx.ag_a)
    sienne = c_a.post(f"/agences/{ctx.ag_a}/categories", json={"nom": "À moi"}).json()

    c_b = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_b, ctx.ag_b)
    r = c_b.patch(f"/agences/{ctx.ag_a}/categories/{sienne['id']}", json={"nom": "Volée"})
    assert r.status_code == 403


def test_cx_manager_garde_tous_ses_droits_meme_sur_une_categorie_creee_par_l_agency_manager(ctx):
    """Non-régression : le CX Manager peut gérer TOUTES les catégories de son organisation,
    y compris celles ajoutées par un Agency Manager."""
    c_am = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_a, ctx.ag_a)
    creee = c_am.post(f"/agences/{ctx.ag_a}/categories", json={"nom": "Idée agence"}).json()

    c_cx = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx)
    r = c_cx.patch(f"/agences/{ctx.ag_a}/categories/{creee['id']}", json={"nom": "Idée agence (validée CX)"})
    assert r.status_code == 200, r.text

    r = c_cx.delete(f"/agences/{ctx.ag_a}/categories/{creee['id']}")
    assert r.status_code == 204

    # Et sur la catégorie qu'il a lui-même créée, bien sûr toujours.
    r = c_cx.patch(f"/agences/{ctx.ag_a}/categories/{ctx.cat_cx}", json={"nom": "Accueil (CX) v2"})
    assert r.status_code == 200


# ── Liste (inchangée) ──────────────────────────────────────────────────────────

def test_liste_agency_manager_montre_les_categories_actives_des_deux_createurs(ctx):
    c_am = ctx.client_pour(UserRole.AGENCY_MANAGER, ctx.am_a, ctx.ag_a)
    c_am.post(f"/agences/{ctx.ag_a}/categories", json={"nom": "Mienne"})

    r = c_am.get(f"/agences/{ctx.ag_a}/categories")
    assert r.status_code == 200
    noms = {c["nom"] for c in r.json()}
    assert "Accueil (CX)" in noms   # créée par le CX Manager
    assert "Mienne" in noms         # créée par lui-même

"""
Création d'agence (app/api/v1/endpoints/agences.py::create_agence) : vérifie que le jeu de
catégories de départ du secteur de l'organisation est posé automatiquement
(creer_categories_depart, app/services/categorie_templates.py) — secteur telecom : 7
catégories actives + "Mobile Money" inactive. Secteur sans registre : comportement
inchangé (aucune catégorie créée à la création, "Général" reste à la charge du filet
get_or_create_categories_actives, non concerné par ce test).
"""
import os
from types import SimpleNamespace
from uuid import UUID, uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-agence-creation-tests-0123456789")

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
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__,
                Categorie.__table__, Utilisateur.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_telecom = Organisation(id=uuid4(), nom="Org Telecom", active=True, secteur_code="telecom")
    org_autre = Organisation(id=uuid4(), nom="Org Autre", active=True, secteur_code="autre")
    db.add_all([org_telecom, org_autre])
    db.commit()

    ids = SimpleNamespace(org_telecom=org_telecom.id, org_autre=org_autre.id)
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(agences.router)
    app.dependency_overrides[get_db] = _db

    users = {
        "cx_telecom": SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_telecom),
        "cx_autre": SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_autre),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(call=call, db=Session(), **vars(ids))


def test_creation_agence_telecom_cree_8_categories_7_actives_1_inactive(ctx):
    r = ctx.call("cx_telecom", "post", "/", json={"nom": "Nouvelle agence telecom"})
    assert r.status_code == 201, r.text
    agence_id = UUID(r.json()["id"])

    categories = ctx.db.query(Categorie).filter(Categorie.agence_id == agence_id).all()
    assert len(categories) == 8
    actives = [c for c in categories if c.active]
    inactives = [c for c in categories if not c.active]
    assert len(actives) == 7
    assert len(inactives) == 1
    assert inactives[0].cle == "mobile_money"
    assert {c.cle for c in categories} == {
        "accueil", "service_client", "carte_sim_numero", "forfaits_recharge",
        "internet_reseau_mobile", "facturation_paiement", "equipements_boutique", "mobile_money",
    }


def test_creation_agence_secteur_sans_registre_ne_cree_aucune_categorie(ctx):
    r = ctx.call("cx_autre", "post", "/", json={"nom": "Nouvelle agence autre secteur"})
    assert r.status_code == 201, r.text
    agence_id = UUID(r.json()["id"])
    assert ctx.db.query(Categorie).filter(Categorie.agence_id == agence_id).count() == 0

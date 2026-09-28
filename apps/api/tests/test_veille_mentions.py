"""
Mentions Veille (table mentions_veille, séparée de feedbacks) : l'ingestion crée des
mentions et jamais de Feedback, déduplique par empreinte au sein de l'organisation,
calcule le sentiment immédiatement, ne stocke aucune identité d'auteur, et un CX Manager
d'une organisation ne voit jamais les mentions d'une autre (liste et synthèse). Base
SQLite en mémoire (comme test_categories_permissions.py) — seule façon d'exercer
réellement la déduplication et le filtrage sans toucher la base partagée : le rapport
explique pourquoi la migration elle-même n'a pas été appliquée avec `alembic upgrade`.
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-veille-mentions-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import veille
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.enums import SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.mention_veille import MentionVeille
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[
            Plan.__table__, Organisation.__table__, Agence.__table__, Utilisateur.__table__,
            QRCode.__table__, Feedback.__table__, MentionVeille.__table__,
        ],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_a = Organisation(id=uuid4(), nom="Org A", active=True)
    org_b = Organisation(id=uuid4(), nom="Org B", active=True)
    db.add_all([org_a, org_b])
    db.flush()

    ag_a = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A", active=True)
    ag_b = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B", active=True)
    db.add_all([ag_a, ag_b])
    db.flush()

    cx_a = Utilisateur(id=uuid4(), organisation_id=org_a.id, nom="N", prenom="CX-A", email="cxa@test.bf",
                        mot_de_passe_hash="x", role=UserRole.CX_MANAGER, active=True)
    cx_b = Utilisateur(id=uuid4(), organisation_id=org_b.id, nom="N", prenom="CX-B", email="cxb@test.bf",
                        mot_de_passe_hash="x", role=UserRole.CX_MANAGER, active=True)
    agency_a = Utilisateur(id=uuid4(), organisation_id=org_a.id, agence_id=ag_a.id, nom="N", prenom="AM-A", email="ama@test.bf",
                            mot_de_passe_hash="x", role=UserRole.AGENCY_MANAGER, active=True)
    admin = Utilisateur(id=uuid4(), organisation_id=org_a.id, nom="N", prenom="Admin", email="admin@test.bf",
                         mot_de_passe_hash="x", role=UserRole.ADMIN, active=True)
    db.add_all([cx_a, cx_b, agency_a, admin])
    db.commit()

    org_a_id, org_b_id = org_a.id, org_b.id
    ag_a_id, ag_b_id = ag_a.id, ag_b.id
    cx_a_id, cx_b_id, agency_a_id, admin_id = cx_a.id, cx_b.id, agency_a.id, admin.id
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(veille.router, prefix="/veille")
    app.dependency_overrides[get_db] = _db

    def client_pour(role, user_id, organisation_id, agence_id=None):
        user = SimpleNamespace(id=user_id, role=role, active=True, agence_id=agence_id, organisation_id=organisation_id)
        app.dependency_overrides[get_current_active_user] = lambda: user
        return TestClient(app)

    return SimpleNamespace(
        Session=Session,
        client_pour=client_pour,
        org_a=org_a_id, org_b=org_b_id,
        ag_a=ag_a_id, ag_b=ag_b_id,
        cx_a=cx_a_id, cx_b=cx_b_id, agency_a=agency_a_id, admin=admin_id,
    )


# ── Ingestion : mentions_veille, jamais feedbacks ──────────────────────────────

def test_ingestion_cree_des_mentions_et_aucun_feedback(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    items = [
        {"text": "Excellent accueil, personnel très professionnel"},
        {"text": "Service catastrophique, attente interminable"},
    ]
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": items})
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]
    assert summary == {"ingested_count": 2, "duplicate_count": 0, "ignored_empty_count": 0}

    db = ctx.Session()
    assert db.query(MentionVeille).filter(MentionVeille.organisation_id == ctx.org_a).count() == 2
    assert db.query(Feedback).count() == 0
    db.close()


def test_items_vides_ignores(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": [{"text": "   "}, {"text": ""}]})
    assert r.status_code == 200, r.text
    assert r.json()["summary"] == {"ingested_count": 0, "duplicate_count": 0, "ignored_empty_count": 2}


def test_doublons_ignores_a_la_deuxieme_ingestion(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    items = [{"text": "Avis identique, toujours le même contenu"}]

    r1 = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": items})
    assert r1.json()["summary"]["ingested_count"] == 1

    # Deuxième extraction du même contenu (variation de casse/espaces — doit rester un doublon).
    r2 = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": [{"text": "  AVIS identique,   toujours le même contenu  "}]})
    assert r2.status_code == 200, r2.text
    assert r2.json()["summary"] == {"ingested_count": 0, "duplicate_count": 1, "ignored_empty_count": 0}

    db = ctx.Session()
    assert db.query(MentionVeille).count() == 1
    db.close()


def test_sentiment_calcule_immediatement(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    items = [
        {"text": "Excellent service, personnel très professionnel et agréable"},
        {"text": "Service catastrophique, vraiment nul"},
    ]
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": items})
    assert r.status_code == 200, r.text

    db = ctx.Session()
    mentions = {m.texte: m for m in db.query(MentionVeille).all()}
    positif = mentions["Excellent service, personnel très professionnel et agréable"]
    negatif = mentions["Service catastrophique, vraiment nul"]
    assert positif.sentiment == SentimentType.POSITIF
    assert negatif.sentiment == SentimentType.NEGATIF
    assert 0.0 <= positif.score_sentiment <= 1.0
    assert 0.0 <= negatif.score_sentiment <= 1.0
    db.close()


def test_aucune_identite_auteur_stockee(ctx):
    colonnes = {c.name for c in MentionVeille.__table__.columns}
    assert not any(mot in colonne for colonne in colonnes for mot in ("auteur", "author", "profil", "profile"))

    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    items = [{
        "text": "Avis avec identité fournie par le microservice",
        "author_name": "Jean Dupont",
        "author_id": "fb-123456",
        "profile_url": "https://facebook.com/jdupont",
    }]
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": items})
    assert r.status_code == 200, r.text

    db = ctx.Session()
    mention = db.query(MentionVeille).first()
    assert "Jean Dupont" not in mention.texte
    assert "fb-123456" not in mention.texte
    db.close()


# ── Cloisonnement par organisation : accès agence, 403 hors CX Manager ─────────

def test_ingest_agence_d_une_autre_organisation_refuse_sans_ecriture(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_b), "items": [{"text": "Tentative d'intrusion"}]})
    assert r.status_code == 403
    assert "organisation" in r.json()["detail"]

    db = ctx.Session()
    assert db.query(MentionVeille).count() == 0
    db.close()


@pytest.mark.parametrize("chemin,methode", [("/veille/mentions", "get"), ("/veille/synthese", "get"), ("/veille/ingest", "post")])
@pytest.mark.parametrize("role,user_attr,agence_attr", [
    (UserRole.AGENCY_MANAGER, "agency_a", "ag_a"),
    (UserRole.ADMIN, "admin", None),
])
def test_403_hors_cx_manager(ctx, chemin, methode, role, user_attr, agence_attr):
    agence_id = getattr(ctx, agence_attr) if agence_attr else None
    client = ctx.client_pour(role, getattr(ctx, user_attr), ctx.org_a, agence_id)
    r = client.post(chemin, json={"agence_id": str(ctx.ag_a), "items": []}) if methode == "post" else client.get(chemin)
    assert r.status_code == 403, f"{role} {methode} {chemin} -> {r.status_code}"


# ── Isolation par organisation : liste et synthèse ─────────────────────────────

def test_cx_manager_ne_voit_jamais_les_mentions_d_une_autre_organisation(ctx):
    # `client_pour` surcharge la dépendance sur l'app FastAPI PARTAGÉE par tous les clients :
    # on ré-acquiert donc un client juste avant chaque appel (jamais deux clients "vivants"
    # en parallèle), sans quoi le dernier `client_pour()` appelé authentifierait tout le monde.
    ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a).post(
        "/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": [
            {"text": "Mention organisation A, très bon accueil professionnel"},
        ]},
    )
    ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_b, ctx.org_b).post(
        "/veille/ingest", json={"agence_id": str(ctx.ag_b), "items": [
            {"text": "Mention organisation B, service catastrophique"},
            {"text": "Deuxième mention organisation B, personnel agréable"},
        ]},
    )

    # Liste : org A ne voit que sa propre mention.
    r = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a).get("/veille/mentions")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert "organisation A" in data["items"][0]["texte"]

    r_b = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_b, ctx.org_b).get("/veille/mentions")
    assert r_b.json()["total"] == 2

    # Synthèse : le total de l'org A reste 1, jamais 3.
    s = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a).get("/veille/synthese")
    assert s.status_code == 200
    assert s.json()["total"] == 1

    s_b = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_b, ctx.org_b).get("/veille/synthese")
    assert s_b.json()["total"] == 2

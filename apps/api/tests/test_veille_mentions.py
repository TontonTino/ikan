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
from datetime import datetime, timedelta, timezone
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
from app.services.ai import classification_service
from app.services import veille_service


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


def test_classification_ikan_est_appelee_sans_note_et_persistee(ctx, monkeypatch):
    appels = []

    def fake_classify(texte, note=None):
        appels.append((texte, note))
        return {
            "sentiment": "negative",
            "score_sentiment": 0.21,
            "theme": "facturation",
            "theme_confidence": 0.87,
            "theme_matched": True,
        }

    monkeypatch.setattr(veille_service, "classify", fake_classify)
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    response = client.post("/veille/ingest", json={"items": [{
        "source": "facebook",
        "source_id": "comment-42",
        "text": "La facturation est incorrecte",
    }]})
    assert response.status_code == 200, response.text
    assert appels == [("La facturation est incorrecte", None)]

    db = ctx.Session()
    mention = db.query(MentionVeille).one()
    assert mention.sentiment == SentimentType.NEGATIF
    assert mention.score_sentiment == 0.21
    assert mention.theme_principal == "facturation"
    assert mention.theme_confidence == 0.87
    assert mention.external_id == "comment-42"
    assert mention.date_analyse is not None
    assert db.query(Feedback).count() == 0
    db.close()


def test_theme_de_repli_est_persiste_comme_absent(ctx, monkeypatch):
    monkeypatch.setattr(classification_service, "_models_initialized", True)
    monkeypatch.setattr(classification_service, "_transformers_available", False)
    monkeypatch.setattr(classification_service, "THEME_LABELS", classification_service._load_labels())

    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    response = client.post("/veille/ingest", json={"items": [{
        "text": "blorple quux zyxw",
    }]})
    assert response.status_code == 200, response.text

    db = ctx.Session()
    mention = db.query(MentionVeille).one()
    assert mention.theme_principal is None
    assert mention.theme_confidence is None
    assert mention.date_analyse is not None
    db.close()


def test_deduplication_priorise_plateforme_et_identifiant_externe(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    items = [
        {"source": "facebook", "source_id": "same-id", "text": "Première version"},
        {"source": "facebook", "source_id": "same-id", "text": "Texte légèrement modifié"},
    ]
    response = client.post("/veille/ingest", json={"items": items})
    assert response.status_code == 200, response.text
    assert response.json()["summary"] == {
        "ingested_count": 1, "duplicate_count": 1, "ignored_empty_count": 0,
    }

    db = ctx.Session()
    assert db.query(MentionVeille).count() == 1
    db.close()


def test_api_mentions_filtres_pagination_et_champs_analytiques(ctx, monkeypatch):
    def fake_classify(texte, note=None):
        if "sans thème" in texte:
            return {"sentiment": "neutral", "score_sentiment": 0.5, "theme": "accueil", "theme_confidence": 0.5, "theme_matched": False}
        if "réseau" in texte:
            return {"sentiment": "positive", "score_sentiment": 0.9, "theme": "reseau", "theme_confidence": 0.8, "theme_matched": True}
        return {"sentiment": "negative", "score_sentiment": 0.2, "theme": "facturation", "theme_confidence": 0.7, "theme_matched": True}

    monkeypatch.setattr(veille_service, "classify", fake_classify)
    now = datetime.now(timezone.utc)
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    response = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": [
        {"source_id": "api-1", "plateforme": "facebook", "text": "Commentaire sans thème spécifique", "date_publication": now.isoformat(), "url_source": "https://facebook.com/p/1"},
        {"source_id": "api-2", "plateforme": "facebook", "text": "Le réseau fonctionne bien", "date_publication": (now - timedelta(days=1)).isoformat()},
        {"source_id": "api-3", "plateforme": "google_reviews", "text": "Erreur de facture", "date_publication": (now - timedelta(days=2)).isoformat()},
    ]})
    assert response.status_code == 200, response.text

    liste = client.get("/veille/mentions", params={"limit": 1, "offset": 0})
    assert liste.status_code == 200
    assert liste.json()["total"] == 3
    assert len(liste.json()["items"]) == 1

    non_classes = client.get("/veille/mentions", params={"theme": "non_classe"})
    assert non_classes.status_code == 200
    assert non_classes.json()["total"] == 1
    mention_non_classee = non_classes.json()["items"][0]
    assert mention_non_classee["theme_principal"] is None
    assert mention_non_classee["theme_confidence"] is None
    assert mention_non_classee["score_sentiment"] == 0.5
    assert mention_non_classee["date_analyse"] is not None

    filtres = client.get("/veille/mentions", params={
        "sentiment": "positif", "theme": "reseau", "plateforme": "FACEBOOK",
        "agence_id": str(ctx.ag_a), "date_debut": (now - timedelta(days=2)).isoformat(),
        "date_fin": (now + timedelta(days=1)).isoformat(),
        "recherche": "réseau", "limit": 10, "offset": 0,
    })
    assert filtres.status_code == 200
    assert filtres.json()["total"] == 1
    assert filtres.json()["items"][0]["theme_principal"] == "reseau"

    synthese = client.get("/veille/synthese")
    assert synthese.status_code == 200
    data = synthese.json()
    assert data["total"] == 3
    assert data["par_sentiment"]["positif"]["count"] == 1
    assert data["par_sentiment"]["negatif"]["count"] == 1
    assert {item["theme_principal"]: item["count"] for item in data["par_theme"]}[None] == 1
    assert len(data["serie_journaliere"]) == 3

    filtre_synthese = client.get("/veille/synthese", params={"plateforme": "facebook"})
    assert filtre_synthese.status_code == 200
    assert filtre_synthese.json()["total"] == 2


def test_lecture_mentions_reste_disponible_microservice_veille_hors_ligne(ctx, monkeypatch):
    async def service_hors_ligne():
        return {"status": "offline", "error": "service arrêté pour le test"}

    monkeypatch.setattr(veille, "check_veille_service", service_hors_ligne)
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    ingestion = client.post("/veille/ingest", json={"items": [{
        "source_id": "mention-existante-1",
        "text": "Le réseau fonctionne bien dans la zone",
        "date_publication": datetime.now(timezone.utc).isoformat(),
    }]})
    assert ingestion.status_code == 200, ingestion.text

    etat = client.get("/veille/status")
    assert etat.status_code == 200
    assert etat.json()["service"]["status"] == "offline"

    mentions = client.get("/veille/mentions")
    synthese = client.get("/veille/synthese")
    assert mentions.status_code == 200, mentions.text
    assert mentions.json()["total"] == 1
    assert synthese.status_code == 200, synthese.text
    assert synthese.json()["total"] == 1


def test_masque_email_dans_le_texte(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": [
        {"text": "Contactez-moi à jean.dupont@example.com pour plus d'infos, service excellent"},
    ]})
    assert r.status_code == 200, r.text

    db = ctx.Session()
    mention = db.query(MentionVeille).first()
    assert "jean.dupont@example.com" not in mention.texte
    assert "[email]" in mention.texte
    db.close()


def test_masque_telephone_burkinabe_dans_le_texte(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": [
        {"text": "Appelez-moi au +226 70 12 34 56, très bon accueil"},
    ]})
    assert r.status_code == 200, r.text

    db = ctx.Session()
    mention = db.query(MentionVeille).first()
    assert "70 12 34 56" not in mention.texte
    assert "[téléphone]" in mention.texte
    db.close()


def test_texte_sans_donnee_personnelle_inchange(ctx):
    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx_a, ctx.org_a)
    texte_original = "Excellent accueil, personnel très professionnel, je recommande"
    r = client.post("/veille/ingest", json={"agence_id": str(ctx.ag_a), "items": [{"text": texte_original}]})
    assert r.status_code == 200, r.text

    db = ctx.Session()
    mention = db.query(MentionVeille).first()
    assert mention.texte == texte_original
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

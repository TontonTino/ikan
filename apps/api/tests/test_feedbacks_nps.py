"""
Question NPS facultative après l'envoi (POST /feedbacks renvoie nps_token, POST
/feedbacks/{id}/nps l'utilise). Base SQLite en mémoire, même pattern que
test_feedbacks_demandes_contact.py (analyser_feedback remplacé par un double : ces
tests couvrent le jeton et l'enregistrement, pas l'analyse IA).
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-feedbacks-nps-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import feedbacks
from app.core.config import settings
from app.core.security import create_nps_token
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.services.kpi.engine import calculer_nps

NOW = datetime.now(timezone.utc)


@pytest.fixture()
def ctx(monkeypatch):
    monkeypatch.setattr(feedbacks, "analyser_feedback", lambda feedback_id, db: None)

    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Organisation.__table__, Agence.__table__, Utilisateur.__table__,
                QRCode.__table__, Categorie.__table__, Feedback.__table__, HistoriqueFeedback.__table__,
                DemandeContact.__table__, AnalyseIA.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org = Organisation(id=uuid4(), nom="Org", active=True)
    db.add(org)
    db.flush()
    agence = Agence(id=uuid4(), organisation_id=org.id, nom="Agence", active=True)
    db.add(agence)
    db.flush()
    qr = QRCode(id=uuid4(), agence_id=agence.id, code="QR-NPS", url="http://test/nps", actif=True)
    db.add(qr)
    db.flush()
    categorie = Categorie(id=uuid4(), agence_id=agence.id, nom="Accueil", active=True)
    db.add(categorie)

    # Un feedback déjà existant, créé hors endpoint, pour les cas 403 "autre feedback".
    autre_feedback = Feedback(id=uuid4(), qr_code_id=qr.id, note=3, statut_traitement="nouveau", date_soumission=NOW)
    db.add(autre_feedback)
    db.commit()

    ids = SimpleNamespace(org=org.id, agence=agence.id, qr=qr.id, categorie=categorie.id, autre_feedback=autre_feedback.id)
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.dependency_overrides[get_db] = _db
    client = TestClient(app)

    def call(method, path, **kw):
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(Session=Session, call=call, **vars(ids))


def _soumettre(ctx):
    r = ctx.call("post", "/feedbacks/", params={"qr_code": "QR-NPS"}, json={"categorie_id": str(ctx.categorie), "note": 4})
    assert r.status_code == 201, r.text
    return r.json()


def _token(sub, type_="nps", exp_delta=timedelta(minutes=30)):
    payload = {"sub": str(sub), "type": type_, "exp": datetime.now(timezone.utc) + exp_delta}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


# ── Envoi principal non affecté ──────────────────────────────────────────────────

def test_envoi_principal_renvoie_un_nps_token_sans_changer_les_autres_champs(ctx):
    data = _soumettre(ctx)
    assert data["note"] == 4
    assert data["nps_note"] is None
    assert isinstance(data["nps_token"], str) and len(data["nps_token"]) > 20

    payload = jwt.decode(data["nps_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert payload["type"] == "nps"
    assert payload["sub"] == data["id"]


# ── Jeton valide ──────────────────────────────────────────────────────────────────

def test_jeton_valide_enregistre_la_note_et_le_nps_la_compte(ctx):
    data = _soumettre(ctx)
    r = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 9, "token": data["nps_token"]})
    assert r.status_code == 200, r.text
    assert r.json() == {"nps_note": 9}

    db = ctx.Session()
    persisted = db.query(Feedback).filter(Feedback.id == UUID(data["id"])).one()
    assert persisted.nps_note == 9

    resultat = calculer_nps(db, ctx.org)
    assert resultat.status == "ok"
    assert resultat.denominator == 1  # "le NPS la compte"
    assert resultat.value == 100.0  # 9 = promoteur, seule réponse
    db.close()


# ── Jeton invalide / expiré / autre feedback / autre type : 403 ──────────────────

def test_jeton_invalide_garbage_403(ctx):
    data = _soumettre(ctx)
    r = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 5, "token": "pas-un-jwt"})
    assert r.status_code == 403


def test_jeton_expire_403(ctx):
    data = _soumettre(ctx)
    jeton_expire = _token(data["id"], type_="nps", exp_delta=timedelta(minutes=-1))
    r = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 5, "token": jeton_expire})
    assert r.status_code == 403


def test_jeton_dun_autre_type_403(ctx):
    data = _soumettre(ctx)
    jeton_access = _token(data["id"], type_="access")
    r = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 5, "token": jeton_access})
    assert r.status_code == 403


def test_jeton_dun_autre_feedback_403(ctx):
    """Jeton valide et de type nps, mais émis pour un AUTRE feedback — ne doit jamais
    permettre de répondre à la place du feedback visé par l'URL."""
    data = _soumettre(ctx)
    jeton_autre_feedback = create_nps_token(ctx.autre_feedback)
    r = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 5, "token": jeton_autre_feedback})
    assert r.status_code == 403

    db = ctx.Session()
    assert db.query(Feedback).filter(Feedback.id == UUID(data["id"])).one().nps_note is None
    db.close()


def test_jeton_feedback_inexistant_403(ctx):
    jeton = create_nps_token(uuid4())
    r = ctx.call("post", f"/feedbacks/{uuid4()}/nps", json={"nps_note": 5, "token": jeton})
    assert r.status_code == 403


# ── Deuxième réponse : 409 ────────────────────────────────────────────────────────

def test_deuxieme_reponse_409(ctx):
    data = _soumettre(ctx)
    r1 = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 7, "token": data["nps_token"]})
    assert r1.status_code == 200

    r2 = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 3, "token": data["nps_token"]})
    assert r2.status_code == 409

    db = ctx.Session()
    assert db.query(Feedback).filter(Feedback.id == UUID(data["id"])).one().nps_note == 7  # inchangé
    db.close()


# ── Hors bornes : 422 ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("note_invalide", [-1, 11, 100])
def test_note_hors_bornes_422(ctx, note_invalide):
    data = _soumettre(ctx)
    r = ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": note_invalide, "token": data["nps_token"]})
    assert r.status_code == 422


def test_note_hors_bornes_ne_modifie_rien(ctx):
    data = _soumettre(ctx)
    ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 42, "token": data["nps_token"]})
    db = ctx.Session()
    assert db.query(Feedback).filter(Feedback.id == UUID(data["id"])).one().nps_note is None
    db.close()


# ── Ne modifie aucun autre champ ──────────────────────────────────────────────────

def test_nps_ne_modifie_aucun_autre_champ(ctx):
    data = _soumettre(ctx)
    db = ctx.Session()
    avant = db.query(Feedback).filter(Feedback.id == UUID(data["id"])).one()
    note_avant, statut_avant, commentaire_avant = avant.note, avant.statut_traitement, avant.commentaire
    db.close()

    ctx.call("post", f"/feedbacks/{data['id']}/nps", json={"nps_note": 6, "token": data["nps_token"]})

    db = ctx.Session()
    apres = db.query(Feedback).filter(Feedback.id == UUID(data["id"])).one()
    assert (apres.note, apres.statut_traitement, apres.commentaire) == (note_avant, statut_avant, commentaire_avant)
    assert apres.nps_note == 6
    db.close()

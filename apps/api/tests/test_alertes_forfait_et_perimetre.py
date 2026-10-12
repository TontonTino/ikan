"""
GET /alertes/ — périmètre par rôle, disparition à la résolution, et forfait sans alertes.

Vrai routeur, vraie authentification JWT, SQLite en mémoire, deux organisations clientes.
Un forfait sans alertes renvoie des listes vides ET `alertes_incluses = False` : l'interface ne doit jamais
présenter cette absence comme « rien à signaler ».
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-forfait-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import alertes
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(alertes.router, prefix="/alertes")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    now = datetime.now(timezone.utc)
    org_a, org_b, org_admin = (Organisation(id=uuid4(), nom=n, active=True) for n in ("Client A", "Client B", "Plateforme"))
    db.add_all([org_a, org_b, org_admin]); db.flush()
    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    db.add_all([a1, a2, b1]); db.flush()
    qr = {c: QRCode(id=uuid4(), agence_id=ag.id, code=c, url=f"http://t/{c}", actif=True) for c, ag in [("QR-A1", a1), ("QR-A2", a2), ("QR-B1", b1)]}
    db.add_all(qr.values()); db.flush()

    def avis(code, commentaire, note, heures=72, statut="nouveau", negatif=False):
        fb = Feedback(id=uuid4(), qr_code_id=qr[code].id, note=note, commentaire=commentaire, statut_traitement=statut,
                      date_soumission=now - timedelta(hours=heures))
        db.add(fb); db.flush()
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF if negatif else SentimentType.POSITIF,
                         criticite=CriticiteType.CRITIQUE if negatif else CriticiteType.FAIBLE, score_sentiment=0.1, theme_principal="attente"))
        return fb

    f_a1 = avis("QR-A1", "ALERTE-A1 attente", 1, negatif=True)
    f_a1_resolu = avis("QR-A1", "ALERTE-A1-RESOLU", 1, statut="resolu", negatif=True)
    f_a1_ok = avis("QR-A1", "RAS-A1", 5)
    f_a2 = avis("QR-A2", "ALERTE-A2 accueil", 2)
    f_b1 = avis("QR-B1", "SECRET-ALERTE-B", 1, negatif=True)
    f_a1_recent = avis("QR-A1", "ALERTE-A1-RECENT", 1, heures=1, negatif=True)

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b),
                 am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1), am_b1=user(UserRole.AGENCY_MANAGER, org_b, b1), admin=user(UserRole.ADMIN, org_admin))
    db.commit()
    ids = SimpleNamespace(**{k: v.id for k, v in dict(users, f_a1=f_a1, f_a1_resolu=f_a1_resolu, f_a1_ok=f_a1_ok, f_a2=f_a2, f_b1=f_b1, f_a1_recent=f_a1_recent, a1=a1, a2=a2, b1=b1).items()})
    db.close()
    return SimpleNamespace(client=TestClient(app), H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}, **vars(ids))


def _avis(ctx, acteur):
    r = ctx.client.get("/alertes/", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code == 200, r.text
    return r.json(), {a["feedback_id"] for a in r.json()["alertes_feedback"]}


def test_responsable_voit_les_alertes_de_son_agence_uniquement_et_tout_de_suite(ctx):
    corps, ids = _avis(ctx, "am_a1")
    assert corps["alertes_incluses"] is True
    assert ids == {str(ctx.f_a1), str(ctx.f_a1_recent)}   # immédiat pour le Responsable d'agence
    assert str(ctx.f_a2) not in ids and str(ctx.f_b1) not in ids
    assert "SECRET-ALERTE-B" not in str(corps)


def test_une_alerte_disparait_quand_l_avis_est_resolu_et_un_bon_avis_n_en_declenche_pas(ctx):
    _, ids = _avis(ctx, "am_a1")
    assert str(ctx.f_a1_resolu) not in ids
    assert str(ctx.f_a1_ok) not in ids


def test_cx_voit_son_reseau_apres_le_delai_et_jamais_une_autre_organisation(ctx):
    corps, ids = _avis(ctx, "cx_a")
    assert ids == {str(ctx.f_a1), str(ctx.f_a2)}          # l'avis de 1 h attend encore la fin du délai CX
    assert str(ctx.f_a1_recent) not in ids
    assert "SECRET-ALERTE-B" not in str(corps)
    _, ids_b = _avis(ctx, "cx_b")
    assert ids_b == {str(ctx.f_b1)}


def test_forfait_sans_alertes_listes_vides_et_indicateur_explicite(ctx, monkeypatch):
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: False)
    for acteur in ("am_a1", "cx_a"):
        corps, ids = _avis(ctx, acteur)
        assert ids == set() and corps["alertes_seuil"] == []
        assert corps["alertes_incluses"] is False, acteur


def test_forfait_avec_alertes_indicateur_vrai(ctx, monkeypatch):
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: True)
    assert _avis(ctx, "cx_a")[0]["alertes_incluses"] is True


def test_admin_exclu_et_sans_authentification_refuse(ctx):
    assert ctx.client.get("/alertes/", headers=ctx.H(ctx.admin)).status_code == 403
    assert ctx.client.get("/alertes/").status_code in {401, 403}

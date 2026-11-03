"""
GET /alertes/ — statut de traitement des avis à risque (champ ADDITIF `statut_traitement`).

Le champ n'est qu'une information : la requête, les filtres, les compteurs et les règles de visibilité (48 h CX, immédiat Agency Manager)
ne changent pas. Vrai routeur, vraie authentification JWT, SQLite en mémoire, deux organisations clientes.
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-statut-avis-0123456789")

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

CHAMPS_EXISTANTS = {"feedback_id", "agence_id", "agence_nom", "note", "categorie_nom", "raison", "commentaire", "date_soumission"}


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

    def avis(code, commentaire, note, statut, heures=72):
        fb = Feedback(id=uuid4(), qr_code_id=qr[code].id, note=note, commentaire=commentaire, statut_traitement=statut,
                      date_soumission=now - timedelta(hours=heures))
        db.add(fb); db.flush()
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF, criticite=CriticiteType.CRITIQUE,
                         score_sentiment=0.1, theme_principal="attente"))
        return fb.id

    f = SimpleNamespace(
        nouveau=avis("QR-A1", "A1 nouveau", 1, "nouveau"),
        en_traitement=avis("QR-A1", "A1 en traitement", 1, "en_traitement"),
        en_cours=avis("QR-A1", "A1 en cours", 2, "en_cours"),
        resolu=avis("QR-A1", "A1 resolu", 1, "resolu"),
        heritee=avis("QR-A1", "A1 héritée", 1, "recontacte"),
        vide=avis("QR-A1", "A1 vide", 1, ""),
        a2_en_traitement=avis("QR-A2", "A2 en traitement", 1, "en_traitement"),
        b1_en_traitement=avis("QR-B1", "SECRET-B en traitement", 1, "en_traitement"),
    )

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b),
                 am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1), am_b1=user(UserRole.AGENCY_MANAGER, org_b, b1), admin=user(UserRole.ADMIN, org_admin))
    db.commit()
    ids = {k: v.id for k, v in users.items()}
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, f=f, H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}, **ids)


def _lignes(ctx, acteur):
    r = ctx.client.get("/alertes/", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code == 200, r.text
    return {a["feedback_id"]: a for a in r.json()["alertes_feedback"]}


def test_chaque_ligne_porte_le_statut_tel_qu_en_base_et_les_champs_existants_sont_inchanges(ctx):
    lignes = _lignes(ctx, "am_a1")
    attendu = {"nouveau": "nouveau", "en_traitement": "en_traitement", "en_cours": "en_cours"}
    for nom, statut in attendu.items():
        assert lignes[str(getattr(ctx.f, nom))]["statut_traitement"] == statut, nom
    for ligne in lignes.values():
        assert CHAMPS_EXISTANTS <= set(ligne), "un champ existant a disparu"
        assert set(ligne) == CHAMPS_EXISTANTS | {"statut_traitement"}, "seul statut_traitement est ajouté"
        assert "date_assignation" not in ligne, "aucune date de prise en charge n'est exposée (fuseau non démontré)"


def test_valeur_heritee_ou_vide_est_renvoyee_sans_erreur(ctx):
    lignes = _lignes(ctx, "am_a1")
    assert lignes[str(ctx.f.heritee)]["statut_traitement"] == "recontacte"
    assert lignes[str(ctx.f.vide)]["statut_traitement"] == ""


def test_le_schema_tolere_un_statut_null_ou_absent():
    base = dict(feedback_id=uuid4(), agence_id=uuid4(), agence_nom="A", note=1, categorie_nom=None, raison="note_basse",
                commentaire=None, date_soumission=datetime.now(timezone.utc))
    assert alertes.AlerteFeedbackResponse(**base).statut_traitement is None           # champ optionnel : un ancien producteur reste valide
    assert alertes.AlerteFeedbackResponse(**base, statut_traitement=None).statut_traitement is None


def test_les_avis_resolus_restent_exclus_pour_tous_les_roles(ctx):
    assert str(ctx.f.resolu) not in _lignes(ctx, "am_a1")
    assert str(ctx.f.resolu) not in _lignes(ctx, "cx_a")


def test_le_statut_ne_change_ni_la_liste_ni_les_compteurs(ctx):
    """Mêmes avis, mêmes compteurs, que leur statut soit « nouveau », « en_traitement » ou « en_cours » (hors « resolu »)."""
    avant = {acteur: set(_lignes(ctx, acteur)) for acteur in ("am_a1", "cx_a", "cx_b")}
    with ctx.Session() as db:
        db.query(Feedback).filter(Feedback.id == ctx.f.nouveau).update({"statut_traitement": "en_cours"})
        db.query(Feedback).filter(Feedback.id == ctx.f.en_cours).update({"statut_traitement": "nouveau"})
        db.commit()
    apres = {acteur: set(_lignes(ctx, acteur)) for acteur in ("am_a1", "cx_a", "cx_b")}
    assert avant == apres
    assert (len(avant["am_a1"]), len(avant["cx_a"]), len(avant["cx_b"])) == (5, 6, 1)


def test_resoudre_un_avis_le_retire_toujours_de_la_liste(ctx):
    assert str(ctx.f.en_traitement) in _lignes(ctx, "am_a1")
    with ctx.Session() as db:
        db.query(Feedback).filter(Feedback.id == ctx.f.en_traitement).update({"statut_traitement": "resolu"})
        db.commit()
    assert str(ctx.f.en_traitement) not in _lignes(ctx, "am_a1")


def test_perimetres_inchanges(ctx):
    am = _lignes(ctx, "am_a1")
    assert str(ctx.f.a2_en_traitement) not in am and str(ctx.f.b1_en_traitement) not in am
    cx = _lignes(ctx, "cx_a")
    assert str(ctx.f.a2_en_traitement) in cx and str(ctx.f.b1_en_traitement) not in cx
    assert "SECRET-B" not in str(cx) and "SECRET-B" not in str(am)
    assert set(_lignes(ctx, "cx_b")) == {str(ctx.f.b1_en_traitement)}
    assert set(_lignes(ctx, "am_b1")) == {str(ctx.f.b1_en_traitement)}


def test_delai_cx_inchange_un_avis_recent_pris_en_charge_reste_invisible_du_cx(ctx):
    with ctx.Session() as db:
        db.query(Feedback).filter(Feedback.id == ctx.f.en_traitement).update(
            {"date_soumission": datetime.now(timezone.utc) - timedelta(hours=1)})
        db.commit()
    assert str(ctx.f.en_traitement) not in _lignes(ctx, "cx_a")      # CX : le délai (48 h par défaut) court toujours
    assert str(ctx.f.en_traitement) in _lignes(ctx, "am_a1")         # Agency Manager : immédiat


def test_admin_refuse_et_anonyme_refuse(ctx):
    assert ctx.client.get("/alertes/", headers=ctx.H(ctx.admin)).status_code == 403
    assert ctx.client.get("/alertes/").status_code in {401, 403}

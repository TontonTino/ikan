"""
Pack KPI telecom — réclamations basées sur les feedbacks
(app/services/kpi/engine.py::calculer_tel_reclamations_*). Base SQLite en mémoire, jeu de
données construit à la main :

Org A (telecom), agence A1, période 30 jours — 10 feedbacks :
  - clé internet_reseau_mobile : 3 NEGATIF, 1 POSITIF, 1 non analysé
  - clé forfaits_recharge      : 1 NEGATIF
  - clé facturation_paiement   : 1 NEUTRE
  - clé accueil                : 1 NEGATIF (autre clé : jamais compté)
  - catégorie SANS clé nommée "Internet & Réseau Mobile" : 1 NEGATIF (le nom n'est jamais lu)
  - sans catégorie             : 1 NEGATIF
  + 1 feedback internet_reseau_mobile NEGATIF vieux de 40 jours (hors période 30 j)
  => A1 : RESEAU 3/10 = 30.0 ; RECHARGE 1/10 = 10.0 ; FACTURATION 0/10 = 0.0
     A1 sur 90 j : RESEAU 4/11 = 36.4
Org A, agence A2 — 2 feedbacks NEGATIF, catégorie nommée "Réseau" avec la clé
  internet_reseau_mobile => A2 seule : no_data (2 < 5) ; org A entière : RESEAU 5/12 = 41.7
Org B (telecom) — exactement 5 feedbacks internet_reseau_mobile NEGATIF => 100.0 (seuil atteint)
Org C (telecom) — 4 feedbacks internet_reseau_mobile NEGATIF => no_data (4 < 5)

Les clés sont écrites en dur dans ce jeu de données (jamais relues depuis
packs_telecom.CLE_PAR_KPI_RECLAMATIONS) : changer une clé dans le code fait échouer ces tests.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-telecom-reclamations-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import kpis
from app.db.session import Base, get_db
from app.models.action_corrective import ActionCorrective
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.issue_escalation import IssueEscalation
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.services.categorie_templates import SECTEUR_CATEGORIES_DEPART
from app.services.kpi.definitions import KPI_DEFINITIONS
from app.services.kpi.engine import (
    KPI_FUNCTIONS,
    calculer_negative_sentiment_rate,
    calculer_tel_reclamations_facturation,
    calculer_tel_reclamations_recharge_forfait,
    calculer_tel_reclamations_reseau,
)
from app.services.kpi.packs_telecom import CLE_PAR_KPI_RECLAMATIONS

NOW = datetime.now(timezone.utc)
IL_Y_A_40_JOURS = NOW - timedelta(days=40)

CODES = ("TEL_RECLAMATIONS_RESEAU", "TEL_RECLAMATIONS_RECHARGE_FORFAIT", "TEL_RECLAMATIONS_FACTURATION")
POS, NEG, NEU = SentimentType.POSITIF, SentimentType.NEGATIF, SentimentType.NEUTRE


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__, Categorie.__table__,
                Feedback.__table__, AnalyseIA.__table__, Issue.__table__, HistoriqueIssue.__table__,
                ActionCorrective.__table__, IssueEscalation.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    secteurs = ["telecom", "banque", "sante", "commerce", "restauration", "hotellerie", "autre"]
    org_a = Organisation(id=uuid.uuid4(), nom="Org A", active=True, secteur_code="telecom")
    org_b = Organisation(id=uuid.uuid4(), nom="Org B", active=True, secteur_code="telecom")
    org_c = Organisation(id=uuid.uuid4(), nom="Org C", active=True, secteur_code="telecom")
    autres = {s: Organisation(id=uuid.uuid4(), nom=f"Org {s}", active=True, secteur_code=s) for s in secteurs if s != "telecom"}
    db.add_all([org_a, org_b, org_c, *autres.values()])
    db.flush()

    def agence(org, nom):
        a = Agence(id=uuid.uuid4(), organisation_id=org.id, nom=nom, active=True)
        q = QRCode(id=uuid.uuid4(), agence_id=a.id, code=f"QR-{nom}", url="http://t", actif=True)
        db.add_all([a, q])
        db.flush()
        return a, q

    def categorie(agence_id, nom, cle):
        c = Categorie(id=uuid.uuid4(), agence_id=agence_id, nom=nom, active=True, cle=cle)
        db.add(c)
        db.flush()
        return c

    def feedback(qr, categorie_id, sentiment, date=NOW):
        fb = Feedback(id=uuid.uuid4(), qr_code_id=qr.id, categorie_id=categorie_id, note=3, commentaire="x",
                      statut_traitement="nouveau", date_soumission=date)
        db.add(fb)
        db.flush()
        if sentiment is not None:
            db.add(AnalyseIA(id=uuid.uuid4(), feedback_id=fb.id, sentiment=sentiment,
                             criticite=CriticiteType.FAIBLE, score_sentiment=0.5))

    a1, qr_a1 = agence(org_a, "A1")
    a2, qr_a2 = agence(org_a, "A2")
    reseau_a1 = categorie(a1.id, "Internet & Réseau Mobile", "internet_reseau_mobile")
    recharge_a1 = categorie(a1.id, "Forfaits & Recharge", "forfaits_recharge")
    facture_a1 = categorie(a1.id, "Facturation & Paiement", "facturation_paiement")
    accueil_a1 = categorie(a1.id, "Accueil", "accueil")
    faux_reseau_a1 = categorie(a1.id, "Internet & Réseau Mobile", None)
    for s in (NEG, NEG, NEG, POS, None):
        feedback(qr_a1, reseau_a1.id, s)
    feedback(qr_a1, recharge_a1.id, NEG)
    feedback(qr_a1, facture_a1.id, NEU)
    feedback(qr_a1, accueil_a1.id, NEG)
    feedback(qr_a1, faux_reseau_a1.id, NEG)
    feedback(qr_a1, None, NEG)
    feedback(qr_a1, reseau_a1.id, NEG, date=IL_Y_A_40_JOURS)

    reseau_a2 = categorie(a2.id, "Réseau", "internet_reseau_mobile")
    for _ in range(2):
        feedback(qr_a2, reseau_a2.id, NEG)

    b, qr_b = agence(org_b, "B")
    reseau_b = categorie(b.id, "Internet & Réseau Mobile", "internet_reseau_mobile")
    for _ in range(5):
        feedback(qr_b, reseau_b.id, NEG)

    c, qr_c = agence(org_c, "C")
    reseau_c = categorie(c.id, "Internet & Réseau Mobile", "internet_reseau_mobile")
    for _ in range(4):
        feedback(qr_c, reseau_c.id, NEG)
    db.commit()

    ids = SimpleNamespace(org_a=org_a.id, org_b=org_b.id, org_c=org_c.id, a1=a1.id, a2=a2.id, b=b.id,
                          reseau_a1=reseau_a1.id, autres={s: o.id for s, o in autres.items()})
    db.close()
    return SimpleNamespace(Session=Session, **vars(ids))


@pytest.fixture()
def db(ctx):
    s = ctx.Session()
    yield s
    s.close()


def _val(r):
    return (r.status, r.value, r.numerator, r.denominator)


# ── Registre ────────────────────────────────────────────────────────────────────

def test_cles_des_kpi_reclamations():
    assert CLE_PAR_KPI_RECLAMATIONS == {
        "TEL_RECLAMATIONS_RESEAU": "internet_reseau_mobile",
        "TEL_RECLAMATIONS_RECHARGE_FORFAIT": "forfaits_recharge",
        "TEL_RECLAMATIONS_FACTURATION": "facturation_paiement",
    }
    cles_telecom = {c.cle for c in SECTEUR_CATEGORIES_DEPART["telecom"]}
    assert set(CLE_PAR_KPI_RECLAMATIONS.values()) <= cles_telecom


@pytest.mark.parametrize("code", CODES)
def test_definitions(code):
    d = KPI_DEFINITIONS[code]
    assert d.unit == "percent"
    assert d.famille == "sectoriel"
    assert d.secteur_code == "telecom"
    assert "basé sur les feedbacks" in d.label
    assert code in KPI_FUNCTIONS


# ── Formule (cas calculés à la main) ────────────────────────────────────────────

def test_formule_agence_a1(ctx, db):
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.a1)) == ("ok", 30.0, 3, 10)
    assert _val(calculer_tel_reclamations_recharge_forfait(db, ctx.org_a, agence_id=ctx.a1)) == ("ok", 10.0, 1, 10)
    assert _val(calculer_tel_reclamations_facturation(db, ctx.org_a, agence_id=ctx.a1)) == ("ok", 0.0, 0, 10)


def test_formule_organisation_entiere(ctx, db):
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_a)) == ("ok", 41.7, 5, 12)
    assert _val(calculer_tel_reclamations_recharge_forfait(db, ctx.org_a)) == ("ok", 8.3, 1, 12)
    assert _val(calculer_tel_reclamations_facturation(db, ctx.org_a)) == ("ok", 0.0, 0, 12)


def test_periode_90_jours_inclut_le_feedback_ancien(ctx, db):
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.a1, jours=90)) == ("ok", 36.4, 4, 11)


def test_negatif_meme_definition_que_negative_sentiment_rate(ctx, db):
    """Sur l'agence A1, NEGATIVE_SENTIMENT_RATE compte 7 feedbacks NEGATIF (toutes
    catégories) : la somme des numérateurs des 3 KPI ne peut pas la dépasser, et le
    feedback réseau non analysé n'est jamais compté négatif (3, pas 4)."""
    nsr = calculer_negative_sentiment_rate(db, ctx.org_a, agence_id=ctx.a1)
    assert nsr.numerator == 7
    total = sum(
        f(db, ctx.org_a, agence_id=ctx.a1).numerator
        for f in (calculer_tel_reclamations_reseau, calculer_tel_reclamations_recharge_forfait,
                  calculer_tel_reclamations_facturation)
    )
    assert total == 4 <= nsr.numerator


# ── Seuil de 5 feedbacks ───────────────────────────────────────────────────────

def test_seuil_exactement_5_feedbacks_ok(ctx, db):
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_b)) == ("ok", 100.0, 5, 5)


def test_seuil_4_feedbacks_no_data(ctx, db):
    r = calculer_tel_reclamations_reseau(db, ctx.org_c)
    assert _val(r) == ("no_data", None, 4, 4)


def test_seuil_sur_le_perimetre_agence(ctx, db):
    """A2 seule n'a que 2 feedbacks : no_data, même si l'organisation entière passe le seuil."""
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.a2)) == ("no_data", None, 2, 2)


# ── Rattachement par clé, jamais par nom ───────────────────────────────────────

def test_categorie_renommee_garde_son_kpi(ctx, db):
    avant = _val(calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.a1))
    cat = db.get(Categorie, ctx.reseau_a1)
    cat.nom = "Nom totalement différent"
    db.commit()
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.a1)) == avant == ("ok", 30.0, 3, 10)


def test_categorie_sans_cle_au_nom_identique_jamais_comptee(ctx, db):
    """La catégorie sans clé nommée « Internet & Réseau Mobile » porte 1 feedback NEGATIF :
    il reste au dénominateur (10) mais jamais au numérateur (3, pas 4)."""
    r = calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.a1)
    assert (r.numerator, r.denominator) == (3, 10)


def test_cle_retiree_sort_du_numerateur(ctx, db):
    cat = db.get(Categorie, ctx.reseau_a1)
    cat.cle = None
    db.commit()
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.a1)) == ("ok", 0.0, 0, 10)


# ── Isolation organisation / agence ────────────────────────────────────────────

def test_isolation_organisation(ctx, db):
    """Org B (5 négatifs réseau) n'influence jamais org A, et inversement."""
    assert calculer_tel_reclamations_reseau(db, ctx.org_a).denominator == 12
    assert calculer_tel_reclamations_reseau(db, ctx.org_b).denominator == 5


def test_agence_dune_autre_organisation_ne_renvoie_rien(ctx, db):
    """Agence B passée avec l'organisation A : le scope organisation l'emporte, aucune
    donnée de B ne fuit."""
    assert _val(calculer_tel_reclamations_reseau(db, ctx.org_a, agence_id=ctx.b)) == ("no_data", None, 0, 0)


# ── API : visibilité telecom uniquement, RBAC inchangé ─────────────────────────

@pytest.fixture()
def api(ctx):
    def _db():
        s = ctx.Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(kpis.router, prefix="/kpis")
    app.dependency_overrides[get_db] = _db
    users = {f"cx_{s}": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=o)
             for s, o in ctx.autres.items()}
    users["cx_a"] = SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ctx.org_a)
    users["am_a1"] = SimpleNamespace(role=UserRole.AGENCY_MANAGER, active=True, agence_id=ctx.a1, organisation_id=ctx.org_a)
    client = TestClient(app)

    def call(user_key, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return client.get(path, **kw)

    return call


@pytest.mark.parametrize("code", CODES)
def test_api_telecom_collection_et_code(api, code):
    collection = {k["code"]: k for k in api("cx_a", "/kpis/").json()["kpis"]}
    assert collection[code]["famille"] == "sectoriel"
    r = api("cx_a", f"/kpis/{code}")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == code


def test_api_agency_manager_force_sur_son_agence(api):
    r = api("am_a1", "/kpis/TEL_RECLAMATIONS_RESEAU")
    assert (r.status_code, r.json()["value"], r.json()["denominator"]) == (200, 30.0, 10)
    interdit = api("am_a1", "/kpis/TEL_RECLAMATIONS_RESEAU", params={"agence_id": str(uuid.uuid4())})
    assert interdit.status_code == 403


@pytest.mark.parametrize("code", CODES)
@pytest.mark.parametrize("secteur", ["banque", "sante", "commerce", "restauration", "hotellerie", "autre"])
def test_api_404_hors_telecom_meme_message_quun_code_inconnu(api, secteur, code):
    collection = {k["code"] for k in api(f"cx_{secteur}", "/kpis/").json()["kpis"]}
    assert code not in collection
    r = api(f"cx_{secteur}", f"/kpis/{code}")
    assert r.status_code == 404
    r_inconnu = api(f"cx_{secteur}", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", code)

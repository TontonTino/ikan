"""
Pack KPI restauration — catégories de départ, calculs (engine.py::calculer_resto_*) et
visibilité API. Base SQLite en mémoire, jeu de données construit à la main :

Org R (restauration), agence R1, période 30 jours :
  feedbacks (sentiment IA, demande de contact) :
    2 NEGATIF + rappel traité        1 NEGATIF + rappel non traité
    1 NEGATIF + contact e-mail seul  3 NEGATIF sans contact
    2 POSITIF + rappel traité        1 NEUTRE + rappel non traité
    2 POSITIF sans contact           1 non analysé sans contact
    + 1 NEGATIF sans contact vieux de 40 jours (hors période)
  => RECONTACTS 4/6 = 66.7 ; RISQUE_SILENCIEUX 3/7 = 42.9
  Issues (catégorie à clé) : origines O1 resolue, O2 verifiee, O3 resolue ; S1 resolue,
    S2 verifiee, S3 ouverte ; récurrences Rc1 (O1) resolue, Rc2 (O2) ouverte.
    + leurre : catégorie SANS clé nommée « Qualité des plats » (résolue, récurrente),
      Issue sans catégorie (résolue), Issue récurrente résolue vieille de 40 jours.
  => RECIDIVE 2/6 = 33.3
Org R, agence R2 : 1 NEGATIF + rappel traité, 1 NEGATIF sans contact, 1 POSITIF + rappel
  non traité ; Issues O4 resolue (catégorie nommée « Cuisine », clé qualite_plats), Rc3
  (O4) ouverte.
  => R2 seule : no_data partout ; org R entière : RECONTACTS 5/8 = 62.5,
     RISQUE_SILENCIEUX 4/9 = 44.4, RECIDIVE 3/7 = 42.9
Org X (restauration) : 5 NEGATIF + rappel traité ; 5 Issues résolues dont 1 récurrente
  => 100.0 / 0.0 / 20.0 (seuil de 5 exactement atteint)
Org C (restauration) : 4 NEGATIF sans contact, 4 Issues résolues => no_data partout
Org Y (restauration) : 5 origines résolues + 6 récurrences ouvertes => RECIDIVE 120.0
  (le numérateur n'est pas un sous-ensemble du dénominateur — comportement documenté)

Les clés sont écrites en dur dans ce jeu de données : changer une clé dans
SECTEUR_CATEGORIES_DEPART["restauration"] fait échouer ces tests.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-restauration-0123456789")

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
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.issue_escalation import IssueEscalation
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.services.categorie_templates import SECTEUR_CATEGORIES_DEPART, creer_categories_depart
from app.services.kpi.definitions import KPI_DEFINITIONS
from app.services.kpi.engine import (
    KPI_FUNCTIONS,
    calculer_resto_recidive_categorie,
    calculer_resto_risque_silencieux,
    calculer_resto_taux_traitement_recontacts,
)
from app.services.kpi.packs_restauration import CLES_RESTAURATION

NOW = datetime.now(timezone.utc)
VIEUX = NOW - timedelta(days=40)
NEG, POS, NEU = SentimentType.NEGATIF, SentimentType.POSITIF, SentimentType.NEUTRE
CODES = ("RESTO_TAUX_TRAITEMENT_RECONTACTS", "RESTO_RISQUE_SILENCIEUX", "RESTO_RECIDIVE_CATEGORIE")
CX_CORE = {
    "CSAT", "NEGATIVE_SENTIMENT_RATE", "FEEDBACK_VOLUME", "ISSUE_VOLUME",
    "CRITICAL_ISSUE_RATE", "ISSUE_RESOLUTION_RATE", "MEDIAN_RESOLUTION_TIME", "LOOP_CLOSURE_RATE",
}
AUTRES_SECTEURS = ["banque", "telecom", "sante", "commerce", "hotellerie", "autre"]


# ── Catégories de départ ───────────────────────────────────────────────────────

def test_categories_de_depart_restauration():
    assert [(c.cle, c.libelle, c.active) for c in SECTEUR_CATEGORIES_DEPART["restauration"]] == [
        ("accueil_service_salle", "Accueil & service en salle", True),
        ("qualite_plats", "Qualité des plats", True),
        ("rapidite_attente", "Rapidité / Attente", True),
        ("proprete_cadre", "Propreté & cadre", True),
        ("addition_paiement", "Addition & paiement", True),
        ("livraison_emporter", "Livraison / À emporter", True),
        ("suggestion_compliment", "Suggestion / Compliment", True),
    ]
    assert CLES_RESTAURATION == {c.cle for c in SECTEUR_CATEGORIES_DEPART["restauration"]}


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__, Categorie.__table__,
                Feedback.__table__, AnalyseIA.__table__, DemandeContact.__table__, Issue.__table__,
                HistoriqueIssue.__table__, ActionCorrective.__table__, IssueEscalation.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    def org(nom, secteur="restauration"):
        o = Organisation(id=uuid.uuid4(), nom=nom, active=True, secteur_code=secteur)
        db.add(o)
        db.flush()
        return o

    def agence(o, nom):
        a = Agence(id=uuid.uuid4(), organisation_id=o.id, nom=nom, active=True)
        db.add(a)
        db.flush()
        q = QRCode(id=uuid.uuid4(), agence_id=a.id, code=f"QR-{nom}-{uuid.uuid4().hex[:4]}", url="http://t", actif=True)
        db.add(q)
        db.flush()
        return a, q

    def categorie(a, nom, cle):
        c = Categorie(id=uuid.uuid4(), agence_id=a.id, nom=nom, active=True, cle=cle)
        db.add(c)
        db.flush()
        return c

    def feedback(q, sentiment, contact=None, date=NOW):
        """contact : None | ("rappel", traitee) | ("email", traitee)."""
        fb = Feedback(id=uuid.uuid4(), qr_code_id=q.id, note=3, statut_traitement="nouveau", date_soumission=date)
        db.add(fb)
        db.flush()
        if sentiment is not None:
            db.add(AnalyseIA(id=uuid.uuid4(), feedback_id=fb.id, sentiment=sentiment,
                             criticite=CriticiteType.FAIBLE, score_sentiment=0.5))
        if contact is not None:
            genre, traitee = contact
            db.add(DemandeContact(id=uuid.uuid4(), feedback_id=fb.id, souhaite_etre_rappele=(genre == "rappel"),
                                  email="client@example.com" if genre == "email" else None,
                                  telephone="+226 70 00 00 00" if genre == "rappel" else None, traitee=traitee))

    def issue(o, a, cat, statut, origine=None, date=NOW):
        i = Issue(id=uuid.uuid4(), organisation_id=o.id, agence_id=a.id, titre="Issue", statut=statut,
                  severite=CriticiteType.FAIBLE, necessite_action=False, premiere_detection=date,
                  categorie_id=cat.id if cat else None, issue_origine_id=origine.id if origine else None)
        db.add(i)
        db.flush()
        return i

    # ── Org R ──
    org_r = org("Org R")
    r1, qr1 = agence(org_r, "R1")
    r2, qr2 = agence(org_r, "R2")
    plats_r1 = categorie(r1, "Plats", "qualite_plats")
    attente_r1 = categorie(r1, "Attente", "rapidite_attente")
    leurre_r1 = categorie(r1, "Qualité des plats", None)
    cuisine_r2 = categorie(r2, "Cuisine", "qualite_plats")

    for s, c in [(NEG, ("rappel", True))] * 2 + [(NEG, ("rappel", False)), (NEG, ("email", False))] \
            + [(NEG, None)] * 3 + [(POS, ("rappel", True))] * 2 + [(NEU, ("rappel", False))] \
            + [(POS, None)] * 2 + [(None, None)]:
        feedback(qr1, s, c)
    feedback(qr1, NEG, None, date=VIEUX)
    feedback(qr2, NEG, ("rappel", True))
    feedback(qr2, NEG, None)
    feedback(qr2, POS, ("rappel", False))

    o1 = issue(org_r, r1, plats_r1, "resolue", date=NOW - timedelta(days=10))
    o2 = issue(org_r, r1, attente_r1, "verifiee", date=NOW - timedelta(days=10))
    o3 = issue(org_r, r1, plats_r1, "resolue", date=NOW - timedelta(days=10))
    issue(org_r, r1, attente_r1, "resolue")
    issue(org_r, r1, plats_r1, "verifiee")
    issue(org_r, r1, plats_r1, "ouverte")
    issue(org_r, r1, plats_r1, "resolue", origine=o1)
    issue(org_r, r1, attente_r1, "ouverte", origine=o2)
    issue(org_r, r1, leurre_r1, "resolue", origine=o3)          # catégorie sans clé : hors périmètre
    issue(org_r, r1, None, "resolue")                           # sans catégorie : hors périmètre
    issue(org_r, r1, plats_r1, "resolue", origine=o3, date=VIEUX)  # hors période
    o4 = issue(org_r, r2, cuisine_r2, "resolue", date=NOW - timedelta(days=10))
    issue(org_r, r2, cuisine_r2, "ouverte", origine=o4)

    # ── Org X : seuil exactement atteint ──
    org_x = org("Org X")
    x1, qrx = agence(org_x, "X1")
    plats_x = categorie(x1, "Plats", "qualite_plats")
    for _ in range(5):
        feedback(qrx, NEG, ("rappel", True))
    origine_x = issue(org_x, x1, plats_x, "resolue", date=NOW - timedelta(days=5))
    for _ in range(3):
        issue(org_x, x1, plats_x, "resolue")
    issue(org_x, x1, plats_x, "resolue", origine=origine_x)

    # ── Org C : sous le seuil ──
    org_c = org("Org C")
    c1, qrc = agence(org_c, "C1")
    plats_c = categorie(c1, "Plats", "qualite_plats")
    for _ in range(4):
        feedback(qrc, NEG, None)
        issue(org_c, c1, plats_c, "resolue")

    # ── Org Y : récurrences ouvertes plus nombreuses que les résolues ──
    org_y = org("Org Y")
    y1, _ = agence(org_y, "Y1")
    plats_y = categorie(y1, "Plats", "qualite_plats")
    origines_y = [issue(org_y, y1, plats_y, "resolue", date=NOW - timedelta(days=5)) for _ in range(5)]
    for k in range(6):
        issue(org_y, y1, plats_y, "ouverte", origine=origines_y[k % 5])

    autres = {s: org(f"Org {s}", s) for s in AUTRES_SECTEURS}
    db.commit()
    ids = SimpleNamespace(org_r=org_r.id, r1=r1.id, r2=r2.id, x1=x1.id, org_x=org_x.id, org_c=org_c.id,
                          org_y=org_y.id, plats_r1=plats_r1.id, autres={s: o.id for s, o in autres.items()})
    db.close()
    return SimpleNamespace(Session=Session, **vars(ids))


@pytest.fixture()
def db(ctx):
    s = ctx.Session()
    yield s
    s.close()


def _val(r):
    return (r.status, r.value, r.numerator, r.denominator)


# ── Registre / définitions ─────────────────────────────────────────────────────

@pytest.mark.parametrize("code", CODES)
def test_definitions(code):
    d = KPI_DEFINITIONS[code]
    assert (d.unit, d.famille, d.secteur_code) == ("percent", "sectoriel", "restauration")
    assert code in KPI_FUNCTIONS


def test_libelle_et_description_recontacts():
    d = KPI_DEFINITIONS["RESTO_TAUX_TRAITEMENT_RECONTACTS"]
    assert d.label == "Taux de clients recontactés"
    assert "n'importe" in d.description and "pas forcément un appel" in d.description


def test_description_risque_silencieux():
    assert "ne peuvent pas être recontactés" in KPI_DEFINITIONS["RESTO_RISQUE_SILENCIEUX"].description


def test_creer_categories_depart_restauration(ctx, db):
    org = Organisation(id=uuid.uuid4(), nom="Nouveau resto", active=True, secteur_code="restauration")
    db.add(org)
    db.flush()
    agence = Agence(id=uuid.uuid4(), organisation_id=org.id, nom="Nouveau point", active=True)
    db.add(agence)
    db.flush()
    creees = creer_categories_depart(db, agence)
    assert sorted(c.cle for c in creees) == sorted(CLES_RESTAURATION)
    assert len(creees) == 7 and all(c.active for c in creees)


# ── Formules (cas calculés à la main) ──────────────────────────────────────────

def test_formules_agence_r1(ctx, db):
    assert _val(calculer_resto_taux_traitement_recontacts(db, ctx.org_r, agence_id=ctx.r1)) == ("ok", 66.7, 4, 6)
    assert _val(calculer_resto_risque_silencieux(db, ctx.org_r, agence_id=ctx.r1)) == ("ok", 42.9, 3, 7)
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_r, agence_id=ctx.r1)) == ("ok", 33.3, 2, 6)


def test_formules_organisation_entiere(ctx, db):
    assert _val(calculer_resto_taux_traitement_recontacts(db, ctx.org_r)) == ("ok", 62.5, 5, 8)
    assert _val(calculer_resto_risque_silencieux(db, ctx.org_r)) == ("ok", 44.4, 4, 9)
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_r)) == ("ok", 42.9, 3, 7)


def test_recidive_peut_depasser_100(ctx, db):
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_y)) == ("ok", 120.0, 6, 5)


# ── Seuil de 5 au dénominateur ─────────────────────────────────────────────────

def test_seuil_exactement_5_ok(ctx, db):
    assert _val(calculer_resto_taux_traitement_recontacts(db, ctx.org_x)) == ("ok", 100.0, 5, 5)
    assert _val(calculer_resto_risque_silencieux(db, ctx.org_x)) == ("ok", 0.0, 0, 5)
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_x)) == ("ok", 20.0, 1, 5)


def test_seuil_4_no_data(ctx, db):
    assert _val(calculer_resto_taux_traitement_recontacts(db, ctx.org_c)) == ("no_data", None, 0, 0)
    assert _val(calculer_resto_risque_silencieux(db, ctx.org_c)) == ("no_data", None, 4, 4)
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_c)) == ("no_data", None, 0, 4)


def test_seuil_sur_le_perimetre_agence(ctx, db):
    assert _val(calculer_resto_taux_traitement_recontacts(db, ctx.org_r, agence_id=ctx.r2)) == ("no_data", None, 1, 2)
    assert _val(calculer_resto_risque_silencieux(db, ctx.org_r, agence_id=ctx.r2)) == ("no_data", None, 1, 2)
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_r, agence_id=ctx.r2)) == ("no_data", None, 1, 1)


# ── Rattachement par clé, jamais par nom ───────────────────────────────────────

def test_categorie_renommee_garde_son_kpi(ctx, db):
    avant = _val(calculer_resto_recidive_categorie(db, ctx.org_r, agence_id=ctx.r1))
    db.get(Categorie, ctx.plats_r1).nom = "Nom totalement différent"
    db.commit()
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_r, agence_id=ctx.r1)) == avant == ("ok", 33.3, 2, 6)


def test_cle_retiree_sort_du_perimetre(ctx, db):
    """Sans la clé qualite_plats sur R1, il ne reste que les Issues rapidite_attente de R1
    (O2 verifiee, S1 resolue, Rc2 ouverte) : 1 récurrente / 2 résolues -> sous le seuil."""
    db.get(Categorie, ctx.plats_r1).cle = None
    db.commit()
    assert _val(calculer_resto_recidive_categorie(db, ctx.org_r, agence_id=ctx.r1)) == ("no_data", None, 1, 2)


# ── Isolation organisation / agence ────────────────────────────────────────────

def test_isolation_organisation(ctx, db):
    assert calculer_resto_taux_traitement_recontacts(db, ctx.org_r).denominator == 8
    assert calculer_resto_taux_traitement_recontacts(db, ctx.org_x).denominator == 5


def test_agence_dune_autre_organisation_ne_renvoie_rien(ctx, db):
    for f in (calculer_resto_taux_traitement_recontacts, calculer_resto_risque_silencieux, calculer_resto_recidive_categorie):
        assert _val(f(db, ctx.org_r, agence_id=ctx.x1)) == ("no_data", None, 0, 0)


# ── API ────────────────────────────────────────────────────────────────────────

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
    users["cx_r"] = SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ctx.org_r)
    users["am_r1"] = SimpleNamespace(role=UserRole.AGENCY_MANAGER, active=True, agence_id=ctx.r1, organisation_id=ctx.org_r)
    client = TestClient(app)

    def call(user_key, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return client.get(path, **kw)

    return call


def test_api_restauration_voit_les_8_universels_plus_les_3_resto(api):
    r = api("cx_r", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = [k["code"] for k in data["kpis"]]
    assert set(codes) == CX_CORE | set(CODES)
    assert len(codes) == 11
    assert data["secteur_code"] == "restauration" and data["pack_disponible"] is True
    familles = {k["code"]: k["famille"] for k in data["kpis"]}
    assert all(familles[c] == "commun_prioritaire" for c in CX_CORE)
    assert all(familles[c] == "sectoriel" for c in CODES)


def test_api_agency_manager_force_sur_son_agence(api):
    r = api("am_r1", "/kpis/RESTO_RISQUE_SILENCIEUX")
    assert (r.status_code, r.json()["value"], r.json()["denominator"]) == (200, 42.9, 7)
    assert api("am_r1", "/kpis/RESTO_RISQUE_SILENCIEUX", params={"agence_id": str(uuid.uuid4())}).status_code == 403


@pytest.mark.parametrize("code", CODES)
@pytest.mark.parametrize("secteur", AUTRES_SECTEURS)
def test_api_404_hors_restauration_meme_message_quun_code_inconnu(api, secteur, code):
    assert code not in {k["code"] for k in api(f"cx_{secteur}", "/kpis/").json()["kpis"]}
    r = api(f"cx_{secteur}", f"/kpis/{code}")
    assert r.status_code == 404
    r_inconnu = api(f"cx_{secteur}", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", code)

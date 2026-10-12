"""
Cycle de traitement d'un avis (Lot 5) : IA, prise en charge humaine, résolution, consultation.

Règle : une analyse IA terminée n'est JAMAIS une prise en charge humaine. La consultation d'un avis
(POST /open, GET) ne change ni son statut ni son attribution ; la prise en charge est une action explicite
(POST /prendre-en-charge, Responsable d'agence uniquement). Vrai routeur, vraie authentification JWT, SQLite en
mémoire, deux organisations clientes.
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-cycle-traitement-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import alertes, dashboard, feedbacks
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.services.dashboard_helpers import (
    est_analyse_ia,
    est_nouveau,
    est_pris_en_charge,
    est_resolu,
    repartition_cycle,
)

# ── Définitions pures ──────────────────────────────────────────────────────────────────────────


def _fb(statut, fid="f1"):
    return SimpleNamespace(id=fid, statut_traitement=statut)


def test_nouveau_analyse_reste_nouveau_et_n_est_pas_pris_en_charge():
    f = _fb("nouveau")
    assert est_nouveau(f) and not est_pris_en_charge(f) and not est_resolu(f)
    assert est_analyse_ia(f, {"f1"})


def test_nouveau_analyse_en_attente_n_est_ni_pris_en_charge_ni_declare_analyse():
    f = _fb("nouveau")
    assert est_nouveau(f) and not est_pris_en_charge(f)
    assert not est_analyse_ia(f, set())


def test_nouveau_dont_l_analyse_a_echoue_n_est_pas_declare_analyse():
    # Le schéma ne persiste pas d'état d'échec : l'absence de ligne d'analyse (échec OU attente) n'est JAMAIS
    # présentée comme une analyse réussie.
    f = _fb("nouveau", fid="f-echec")
    assert not est_analyse_ia(f, {"autre-avis"})
    assert not est_pris_en_charge(f)


def test_en_traitement_est_pris_en_charge_sans_etre_resolu():
    for statut in ("en_traitement", "en_cours"):
        f = _fb(statut)
        assert est_pris_en_charge(f) and not est_resolu(f) and not est_nouveau(f)


def test_resolu_est_resolu_et_a_ete_pris_en_charge():
    f = _fb("resolu")
    assert est_resolu(f) and est_pris_en_charge(f) and not est_nouveau(f)


def test_repartition_cycle_chaque_avis_compte_une_fois():
    avis = [_fb("nouveau", "a"), _fb("nouveau", "b"), _fb("en_traitement", "c"), _fb("en_cours", "d"), _fb("resolu", "e")]
    r = repartition_cycle(avis, {"a", "c", "e"})
    assert r == {"total": 5, "nouveaux": 2, "pris_en_charge": 3, "resolus": 1, "analyses_ia": 3}
    assert r["nouveaux"] + r["pris_en_charge"] == r["total"]


# ── Fixture API ────────────────────────────────────────────────────────────────────────────────


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
    app.include_router(dashboard.router, prefix="/dashboard")
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.include_router(alertes.router, prefix="/alertes")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    org_a, org_b, org_admin = (Organisation(id=uuid4(), nom=n, active=True) for n in ("Client A", "Client B", "Plateforme"))
    db.add_all([org_a, org_b, org_admin]); db.flush()
    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    db.add_all([a1, a2, b1]); db.flush()
    qr = {c: QRCode(id=uuid4(), agence_id=ag.id, code=c, url=f"http://t/{c}", actif=True) for c, ag in [("QR-A1", a1), ("QR-A2", a2), ("QR-B1", b1)]}
    db.add_all(qr.values()); db.flush()

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b), am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1),
                 am_a2=user(UserRole.AGENCY_MANAGER, org_a, a2), am_b1=user(UserRole.AGENCY_MANAGER, org_b, b1), admin=user(UserRole.ADMIN, org_admin))
    db.commit()
    ids = SimpleNamespace(**{k: v.id for k, v in dict(users, a1=a1, a2=a2, b1=b1).items()})
    qr_ids = {k: v.id for k, v in qr.items()}
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, qr=qr_ids,
                           H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}, **vars(ids))


def _avis(ctx, code="QR-A1", statut="nouveau", analyse="terminee", note=1, jours=1, negatif=True):
    """analyse : 'terminee' (ligne AnalyseIA) | 'attente' | 'echec' (aucune ligne : indistinguables aujourd'hui)."""
    db = ctx.Session()
    fb = Feedback(id=uuid4(), qr_code_id=ctx.qr[code], note=note, commentaire="avis test", statut_traitement=statut,
                  date_soumission=datetime.now(timezone.utc) - timedelta(days=jours, hours=3))
    db.add(fb); db.flush()
    if analyse == "terminee":
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF if negatif else SentimentType.POSITIF,
                         criticite=CriticiteType.CRITIQUE if negatif else CriticiteType.FAIBLE, score_sentiment=0.1, theme_principal="attente"))
    db.commit()
    fid = fb.id
    db.close()
    return fid


def _lire(ctx, fid):
    db = ctx.Session()
    try:
        f = db.get(Feedback, fid)
        nb_hist = db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == fid).count()
        types = [h.type_evenement for h in db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == fid).all()]
        return SimpleNamespace(statut=f.statut_traitement, assigne=f.assigne_a_id, date_assignation=f.date_assignation, nb_hist=nb_hist, types=types)
    finally:
        db.close()


def _get(ctx, acteur, url):
    r = ctx.client.get(url, headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code == 200, r.text
    return r.json()


# ── Indicateurs : l'incohérence du Lot 4 ───────────────────────────────────────────────────────


def test_scenario_lot4_68_nouveaux_analyses_et_4_en_traitement(ctx):
    """72 avis, tous analysés par l'IA : 68 « nouveau », 4 « en_traitement ». Toutes les pages donnent 5,6 %."""
    for _ in range(68):
        _avis(ctx, statut="nouveau", analyse="terminee")
    for _ in range(4):
        _avis(ctx, statut="en_traitement", analyse="terminee")

    dash = _get(ctx, "cx_a", f"/dashboard/agence/{ctx.a1}?jours=30")
    assert (dash["feedbacks_nouveaux"], dash["feedbacks_pris_en_charge"], dash["feedbacks_analyses_ia"]) == (68, 4, 72)
    assert dash["taux_prise_en_charge"] == 5.6

    stats_agence = _get(ctx, "cx_a", f"/dashboard/statistics/agency?agence_id={ctx.a1}&jours=30")["kpis"]
    assert stats_agence["feedbacks_traites"]["valeur"] == 4
    assert stats_agence["feedbacks_attente"]["valeur"] == 68
    assert stats_agence["taux_traitement"]["valeur_num"] == 5.6

    stats_cx = _get(ctx, "cx_a", "/dashboard/statistics/cx?jours=30")
    assert stats_cx["kpis"]["taux_traitement"]["valeur_num"] == 5.6
    assert stats_cx["kpis"]["feedbacks_attente"]["valeur"] == 68
    ligne = next(a for a in stats_cx["agences_ranking"] if a["agence_id"] == str(ctx.a1))
    assert (ligne["feedbacks_traites"], ligne["taux_traitement"]) == (4, 5.6)

    # Même définition, même période, même périmètre : les trois endpoints sont d'accord.
    assert dash["taux_prise_en_charge"] == stats_agence["taux_traitement"]["valeur_num"] == stats_cx["kpis"]["taux_traitement"]["valeur_num"] == ligne["taux_traitement"]


def test_un_avis_analyse_mais_nouveau_ne_gonfle_pas_la_prise_en_charge(ctx):
    _avis(ctx, statut="nouveau", analyse="terminee")
    dash = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}")
    assert dash["taux_prise_en_charge"] == 0.0
    assert dash["feedbacks_pris_en_charge"] == 0 and dash["feedbacks_nouveaux"] == 1 and dash["feedbacks_analyses_ia"] == 1


def test_analyse_en_attente_ou_echouee_n_est_pas_comptee_comme_analysee(ctx):
    _avis(ctx, statut="nouveau", analyse="attente")
    _avis(ctx, statut="nouveau", analyse="echec")
    dash = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}")
    assert (dash["feedbacks_nouveaux"], dash["feedbacks_analyses_ia"], dash["feedbacks_pris_en_charge"]) == (2, 0, 0)


def test_en_traitement_est_pris_en_charge_mais_pas_resolu_et_resolu_est_resolu(ctx):
    _avis(ctx, statut="en_traitement")
    _avis(ctx, statut="en_cours")
    _avis(ctx, statut="resolu")
    dash = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}")
    assert dash["feedbacks_pris_en_charge"] == 3 and dash["feedbacks_resolus"] == 1 and dash["feedbacks_nouveaux"] == 0
    # « à traiter » (règle existante) : non résolus -> 2 ; le résolu n'y est plus
    assert dash["feedbacks_a_traiter"] == 2


def test_periode_et_agence_sont_respectees(ctx):
    _avis(ctx, "QR-A1", statut="en_traitement", jours=2)
    _avis(ctx, "QR-A1", statut="nouveau", jours=2)
    _avis(ctx, "QR-A1", statut="en_traitement", jours=40)   # hors période de 30 jours
    _avis(ctx, "QR-A2", statut="nouveau", jours=2)           # autre agence
    a1 = _get(ctx, "cx_a", f"/dashboard/agence/{ctx.a1}?jours=30")
    assert (a1["nombre_feedbacks"], a1["feedbacks_pris_en_charge"], a1["taux_prise_en_charge"]) == (2, 1, 50.0)
    a1_90 = _get(ctx, "cx_a", f"/dashboard/agence/{ctx.a1}?jours=90")
    assert (a1_90["nombre_feedbacks"], a1_90["feedbacks_pris_en_charge"]) == (3, 2)
    reseau = _get(ctx, "cx_a", "/dashboard/statistics/cx?jours=30")["kpis"]
    assert (reseau["total_feedbacks"]["valeur"], reseau["feedbacks_traites"]["valeur"]) == (3, 1)
    # Le périmètre organisationnel est respecté : l'autre organisation n'apparaît pas.
    _avis(ctx, "QR-B1", statut="en_traitement", jours=2)
    assert _get(ctx, "cx_a", "/dashboard/statistics/cx?jours=30")["kpis"]["total_feedbacks"]["valeur"] == 3


def test_aucun_avis_pas_de_taux_trompeur(ctx):
    dash = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}")
    assert dash["taux_prise_en_charge"] is None and dash["feedbacks_nouveaux"] == 0


# ── Consultation ≠ prise en charge ─────────────────────────────────────────────────────────────


def test_consulter_un_avis_ne_change_ni_statut_ni_attribution(ctx):
    fid = _avis(ctx)
    avant = _lire(ctx, fid)
    for _ in range(3):
        assert ctx.client.post(f"/feedbacks/{fid}/open", headers=ctx.H(ctx.am_a1)).status_code == 200
        assert ctx.client.get(f"/feedbacks/{fid}", headers=ctx.H(ctx.am_a1)).status_code == 200
        assert ctx.client.get(f"/feedbacks/{fid}", headers=ctx.H(ctx.cx_a)).status_code == 200
    apres = _lire(ctx, fid)
    assert (apres.statut, apres.assigne, apres.date_assignation, apres.nb_hist) == (avant.statut, None, None, 0)
    assert apres.statut == "nouveau"


def test_prendre_en_charge_applique_la_transition_et_l_attribution(ctx):
    fid = _avis(ctx)
    r = ctx.client.post(f"/feedbacks/{fid}/prendre-en-charge", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200 and r.json()["statut_traitement"] == "en_traitement"
    etat = _lire(ctx, fid)
    assert (etat.statut, etat.assigne, etat.nb_hist, etat.types) == ("en_traitement", ctx.am_a1, 1, ["prise_en_charge"])
    assert etat.date_assignation is not None


def test_prise_en_charge_repetee_est_idempotente(ctx):
    fid = _avis(ctx)
    ctx.client.post(f"/feedbacks/{fid}/prendre-en-charge", headers=ctx.H(ctx.am_a1))
    premier = _lire(ctx, fid)
    for _ in range(3):
        assert ctx.client.post(f"/feedbacks/{fid}/prendre-en-charge", headers=ctx.H(ctx.am_a1)).status_code == 200
        ctx.client.post(f"/feedbacks/{fid}/open", headers=ctx.H(ctx.am_a1))
    apres = _lire(ctx, fid)
    assert (apres.statut, apres.assigne, apres.date_assignation, apres.nb_hist) == (premier.statut, premier.assigne, premier.date_assignation, 1)


@pytest.mark.parametrize("statut", ["en_traitement", "en_cours", "resolu"])
def test_prise_en_charge_ne_touche_pas_un_avis_deja_traite_ou_resolu(ctx, statut):
    fid = _avis(ctx, statut=statut)
    ctx.client.post(f"/feedbacks/{fid}/prendre-en-charge", headers=ctx.H(ctx.am_a1))
    etat = _lire(ctx, fid)
    assert (etat.statut, etat.assigne, etat.nb_hist) == (statut, None, 0)


@pytest.mark.parametrize("acteur", ["am_a2", "am_b1", "cx_a", "cx_b", "admin"])
def test_prise_en_charge_refusee_hors_perimetre_ou_hors_role(ctx, acteur):
    fid = _avis(ctx)
    r = ctx.client.post(f"/feedbacks/{fid}/prendre-en-charge", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code in (403, 404)
    etat = _lire(ctx, fid)
    assert (etat.statut, etat.assigne, etat.nb_hist) == ("nouveau", None, 0)


def test_prise_en_charge_sans_authentification_et_avis_inconnu(ctx):
    fid = _avis(ctx)
    assert ctx.client.post(f"/feedbacks/{fid}/prendre-en-charge").status_code in (401, 403)
    assert ctx.client.post(f"/feedbacks/{uuid4()}/prendre-en-charge", headers=ctx.H(ctx.am_a1)).status_code == 404
    assert _lire(ctx, fid).statut == "nouveau"


def test_les_autres_fonctions_de_consultation_restent_operationnelles(ctx):
    fid = _avis(ctx)
    assert ctx.client.post(f"/feedbacks/{fid}/notes", headers=ctx.H(ctx.am_a1), json={"texte": "note interne"}).status_code == 200
    assert ctx.client.get(f"/feedbacks/{fid}/historique", headers=ctx.H(ctx.am_a1)).status_code == 200
    assert ctx.client.get(f"/feedbacks/{fid}/reponses", headers=ctx.H(ctx.cx_a)).status_code == 200
    etat = _lire(ctx, fid)
    assert etat.statut == "nouveau" and etat.assigne is None
    assert etat.types == ["note_interne"]  # une note est un événement d'audit, pas une transition


# ── Alertes : règles inchangées ────────────────────────────────────────────────────────────────


def test_les_regles_d_alerte_sont_inchangees_par_la_prise_en_charge(ctx):
    fid = _avis(ctx, note=1, negatif=True)
    ids = lambda: {a["feedback_id"] for a in _get(ctx, "am_a1", "/alertes/")["alertes_feedback"]}  # noqa: E731
    assert str(fid) in ids()                                               # avis nouveau analysé : alerte immédiate (Responsable)
    ctx.client.post(f"/feedbacks/{fid}/open", headers=ctx.H(ctx.am_a1))
    assert str(fid) in ids()                                               # consulter ne résout pas l'alerte
    ctx.client.post(f"/feedbacks/{fid}/prendre-en-charge", headers=ctx.H(ctx.am_a1))
    assert str(fid) in ids()                                               # prendre en charge non plus : seule la résolution la lève
    ctx.client.post(f"/feedbacks/{fid}/action-cx", headers=ctx.H(ctx.cx_a), json={"action": "action de test"})
    assert str(fid) in ids()                                               # définir l'action à mener non plus
    ctx.client.post(f"/feedbacks/{fid}/confirmer-action", headers=ctx.H(ctx.am_a1))
    assert str(fid) not in ids()

"""
KPI API (app/api/v1/endpoints/kpis.py) — expose le moteur KPI existant (déjà testé en
profondeur dans test_kpi_engine.py / test_kpi_security.py). Ces tests couvrent la couche
API elle-même : routage, résolution organisation_id/agence_id depuis l'utilisateur
authentifié, RBAC (401/403), et le contrat de réponse — pas les formules de calcul.

Pattern identique à test_issues.py : app FastAPI isolée n'incluant que kpis.router,
dependency_overrides sur get_db et get_current_active_user, utilisateurs SimpleNamespace.
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpis-api-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import kpis
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.action_corrective import ActionCorrective
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, IssueEscalationReason, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.issue_escalation import IssueEscalation
from app.models.historique_issue import HistoriqueIssue
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.services.kpi.definitions import KPI_DEFINITIONS
from app.services.kpi.packs import COMMUNS

NOW = datetime.now(timezone.utc)
IL_Y_A_40_JOURS = NOW - timedelta(days=40)


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__,
                Feedback.__table__, AnalyseIA.__table__, Issue.__table__, HistoriqueIssue.__table__, ActionCorrective.__table__,
                IssueEscalation.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_a = Organisation(id=uuid4(), nom="Org A", active=True)
    org_b = Organisation(id=uuid4(), nom="Org B", active=True)
    org_c = Organisation(id=uuid4(), nom="Org C (vide)", active=True)
    db.add_all([org_a, org_b, org_c])
    db.flush()

    agence_a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", active=True)
    agence_a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", active=True)
    agence_b = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B", active=True)
    agence_c = Agence(id=uuid4(), organisation_id=org_c.id, nom="Agence C", active=True)
    db.add_all([agence_a1, agence_a2, agence_b, agence_c])
    db.flush()

    qr_a1 = QRCode(id=uuid4(), agence_id=agence_a1.id, code="QR-A1", url="http://t/a1", actif=True)
    qr_a2 = QRCode(id=uuid4(), agence_id=agence_a2.id, code="QR-A2", url="http://t/a2", actif=True)
    qr_b = QRCode(id=uuid4(), agence_id=agence_b.id, code="QR-B", url="http://t/b", actif=True)
    db.add_all([qr_a1, qr_a2, qr_b])
    db.flush()

    # Agence A1 : 4 feedbacks récents (2 positifs, 1 négatif analysés, 1 non analysé) +
    # 1 feedback vieux de 40 jours (positif) pour distinguer jours=7/30 (l'exclut) de jours=90 (l'inclut).
    for (note, sentiment), nps_note in zip(
        [(5, SentimentType.POSITIF), (5, SentimentType.POSITIF), (1, SentimentType.NEGATIF), (2, None)],
        [9, 10, 7, 8],
    ):
        fb = Feedback(id=uuid4(), qr_code_id=qr_a1.id, note=note, nps_note=nps_note, commentaire="A1", statut_traitement="nouveau", date_soumission=NOW)
        db.add(fb)
        db.flush()
        if sentiment:
            db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment, criticite=CriticiteType.FAIBLE, score_sentiment=0.5))
    fb_vieux = Feedback(id=uuid4(), qr_code_id=qr_a1.id, note=5, nps_note=0, commentaire="A1 vieux", statut_traitement="nouveau", date_soumission=IL_Y_A_40_JOURS)
    db.add(fb_vieux)

    # Agence A2 : 1 feedback récent, positif analysé (permet de distinguer le filtre agence).
    fb_a2 = Feedback(id=uuid4(), qr_code_id=qr_a2.id, note=5, nps_note=9, commentaire="A2", statut_traitement="nouveau", date_soumission=NOW)
    db.add(fb_a2)
    db.flush()
    db.add(AnalyseIA(id=uuid4(), feedback_id=fb_a2.id, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE, score_sentiment=0.8))

    # Issue org A (sur agence A1) : résolue, critique, nécessite action.
    issue_a = Issue(id=uuid4(), organisation_id=org_a.id, agence_id=agence_a1.id, titre="Issue A",
                    statut="resolue", severite=CriticiteType.CRITIQUE, necessite_action=True,
                    premiere_detection=NOW, date_resolution=NOW, date_limite_sla=NOW + timedelta(hours=1))
    db.add(issue_a)
    db.flush()
    db.add(IssueEscalation(
        id=uuid4(), issue_id=issue_a.id, date_evenement=NOW, motif=IssueEscalationReason.SLA,
        declenchee_par_id=uuid4(), declenchee_par_nom="CX A", declenchee_par_role=UserRole.CX_MANAGER,
        created_at=NOW,
    ))

    # Org B : 1 feedback très négatif, 1 Issue vérifiée nécessitant action (données très
    # différentes de A pour détecter toute fuite).
    fb_b = Feedback(id=uuid4(), qr_code_id=qr_b.id, note=1, nps_note=0, commentaire="B", statut_traitement="nouveau", date_soumission=NOW)
    db.add(fb_b)
    db.flush()
    db.add(AnalyseIA(id=uuid4(), feedback_id=fb_b.id, sentiment=SentimentType.NEGATIF, criticite=CriticiteType.CRITIQUE, score_sentiment=0.0))
    db.add(Issue(id=uuid4(), organisation_id=org_b.id, agence_id=agence_b.id, titre="Issue B",
                 statut="verifiee", severite=CriticiteType.CRITIQUE, necessite_action=True,
                 premiere_detection=NOW, date_resolution=NOW, date_limite_sla=NOW - timedelta(hours=1)))

    # Org C : aucune donnée (feedback/issue) — sert au test no_data.
    db.commit()

    ids = SimpleNamespace(
        org_a=org_a.id, org_b=org_b.id, org_c=org_c.id,
        agence_a1=agence_a1.id, agence_a2=agence_a2.id, agence_b=agence_b.id, agence_c=agence_c.id,
    )
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(kpis.router, prefix="/kpis")
    app.dependency_overrides[get_db] = _db

    users = {
        "cx_a": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_a),
        "am_a1": SimpleNamespace(role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.agence_a1, organisation_id=ids.org_a),
        "cx_b": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_b),
        "cx_c": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_c),
        "admin": SimpleNamespace(role=UserRole.ADMIN, active=True, agence_id=None, organisation_id=None),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(client=client, call=call, **vars(ids))


def _kpis_by_code(payload: dict) -> dict:
    return {k["code"]: k for k in payload["kpis"]}


# ── Contrat / 8 KPI ──────────────────────────────────────────────────────────────

def test_tous_les_kpis_presents_avec_bons_codes(ctx):
    """Org A n'a pas de secteur_code explicite -> défaut "autre" (app/models/organisation.py)
    -> aucun pack sectoriel (PACKS["autre"] est vide, voir app/services/kpi/packs.py) ->
    exactement les 15 communs actuels. Ce n'est plus un nombre figé : si un pack sectoriel
    est un jour injecté dans PACKS["autre"] (improbable mais possible), ce test doit suivre
    sans y être pour quelque chose — voir test_kpi_packs.py pour les tests du registre."""
    r = ctx.call("cx_a", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["organisation_id"] == str(ctx.org_a)
    assert data["agence_id"] is None
    assert data["jours"] == 30
    codes = {k["code"] for k in data["kpis"]}
    assert codes == set(COMMUNS)
    assert len(data["kpis"]) == len(COMMUNS) == 15
    assert data["secteur_code"] == "autre"
    assert data["pack_disponible"] is False


def test_champs_kpi_result_presents(ctx):
    r = ctx.call("cx_a", "get", "/kpis/")
    kpis_map = _kpis_by_code(r.json())
    csat = kpis_map["CSAT"]
    for champ in ("code", "label", "unit", "status", "value", "numerator", "denominator", "verified_count", "requiring_action_count"):
        assert champ in csat


# ── Périodes ─────────────────────────────────────────────────────────────────────

def test_periode_7_exclut_le_feedback_vieux_de_40_jours(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"jours": 7, "agence_id": str(ctx.agence_a1)})
    assert _kpis_by_code(r.json())["FEEDBACK_VOLUME"]["value"] == 4.0


def test_periode_30_exclut_le_feedback_vieux_de_40_jours(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"jours": 30, "agence_id": str(ctx.agence_a1)})
    assert _kpis_by_code(r.json())["FEEDBACK_VOLUME"]["value"] == 4.0


def test_periode_90_inclut_le_feedback_vieux_de_40_jours(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"jours": 90, "agence_id": str(ctx.agence_a1)})
    assert _kpis_by_code(r.json())["FEEDBACK_VOLUME"]["value"] == 5.0


def test_jours_zero_rejete(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"jours": 0})
    assert r.status_code == 422


def test_jours_negatif_rejete(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"jours": -5})
    assert r.status_code == 422


def test_jours_absurde_rejete(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"jours": 10000})
    assert r.status_code == 422


# ── Filtre agence ────────────────────────────────────────────────────────────────

def test_cx_sans_filtre_agence_voit_toute_lorganisation(ctx):
    r = ctx.call("cx_a", "get", "/kpis/")
    assert _kpis_by_code(r.json())["FEEDBACK_VOLUME"]["value"] == 5.0  # 4 (A1) + 1 (A2)


def test_cx_avec_filtre_agence_legitime_ne_voit_que_cette_agence(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"agence_id": str(ctx.agence_a1)})
    data = r.json()
    assert data["agence_id"] == str(ctx.agence_a1)
    assert _kpis_by_code(data)["FEEDBACK_VOLUME"]["value"] == 4.0


def test_cx_agence_hors_organisation_403(ctx):
    r = ctx.call("cx_a", "get", "/kpis/", params={"agence_id": str(ctx.agence_b)})
    assert r.status_code == 403


def test_am_sans_filtre_force_sa_propre_agence(ctx):
    r = ctx.call("am_a1", "get", "/kpis/")
    data = r.json()
    assert data["agence_id"] == str(ctx.agence_a1)
    assert _kpis_by_code(data)["FEEDBACK_VOLUME"]["value"] == 4.0  # jamais A2, même sans filtre explicite


def test_am_avec_sa_propre_agence_explicite_ok(ctx):
    r = ctx.call("am_a1", "get", "/kpis/", params={"agence_id": str(ctx.agence_a1)})
    assert r.status_code == 200


def test_am_agence_differente_meme_organisation_403(ctx):
    r = ctx.call("am_a1", "get", "/kpis/", params={"agence_id": str(ctx.agence_a2)})
    assert r.status_code == 403


# ── Isolation organisationnelle ───────────────────────────────────────────────────

def test_cx_a_ne_voit_pas_les_donnees_de_b(ctx):
    r_a = ctx.call("cx_a", "get", "/kpis/")
    r_b = ctx.call("cx_b", "get", "/kpis/")
    vol_a = _kpis_by_code(r_a.json())["FEEDBACK_VOLUME"]["value"]
    vol_b = _kpis_by_code(r_b.json())["FEEDBACK_VOLUME"]["value"]
    assert vol_a == 5.0
    assert vol_b == 1.0


def test_organisation_id_ne_peut_pas_etre_force_par_query_param(ctx):
    """organisation_id n'est pas un paramètre accepté par l'API : passer celui de B en
    tant que cx_a ne doit avoir aucun effet, la query est ignorée (FastAPI ne la lit
    jamais) et la réponse reste scopée à org_a."""
    r = ctx.call("cx_a", "get", "/kpis/", params={"organisation_id": str(ctx.org_b)})
    assert r.json()["organisation_id"] == str(ctx.org_a)


# ── no_data ────────────────────────────────────────────────────────────────────

def test_organisation_sans_donnees_renvoie_no_data(ctx):
    r = ctx.call("cx_c", "get", "/kpis/")
    assert r.status_code == 200
    kpis_map = _kpis_by_code(r.json())
    assert kpis_map["CSAT"]["status"] == "no_data"
    assert kpis_map["CSAT"]["value"] is None
    assert kpis_map["CRITICAL_ISSUE_RATE"]["status"] == "no_data"
    assert kpis_map["ISSUE_RESOLUTION_RATE"]["status"] == "no_data"
    assert kpis_map["MEDIAN_RESOLUTION_TIME"]["status"] == "no_data"
    assert kpis_map["LOOP_CLOSURE_RATE"]["status"] == "no_data"
    # Les KPI de volume restent "ok" avec value=0.0, jamais no_data.
    assert kpis_map["FEEDBACK_VOLUME"]["status"] == "ok"
    assert kpis_map["FEEDBACK_VOLUME"]["value"] == 0.0
    assert kpis_map["ISSUE_VOLUME"]["status"] == "ok"
    assert kpis_map["ISSUE_VOLUME"]["value"] == 0.0
    assert kpis_map["ISSUE_BACKLOG"]["status"] == "ok"
    assert kpis_map["ISSUE_BACKLOG"]["value"] == 0.0
    assert kpis_map["BACKLOG_AGE"]["status"] == "no_data"
    assert kpis_map["ACTION_COMPLETION_RATE"]["status"] == "no_data"
    assert kpis_map["NPS"]["status"] == "no_data"
    assert kpis_map["SLA_COMPLIANCE_RATE"]["status"] == "no_data"


def test_no_data_jamais_utilise_pour_masquer_un_refus_dautorisation(ctx):
    """Un agence_id hors périmètre doit rester un 403 franc, jamais un 200 avec no_data."""
    r = ctx.call("cx_a", "get", "/kpis/", params={"agence_id": str(ctx.agence_b)})
    assert r.status_code == 403
    assert r.json() != {"status": "no_data"}


# ── Endpoint individuel /kpis/{code} ──────────────────────────────────────────────

def test_kpi_individuel_par_code(ctx):
    r = ctx.call("cx_a", "get", "/kpis/CSAT")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == "CSAT"


def test_nps_in_collection_et_endpoint_individuel_avec_rbac(ctx):
    collection = ctx.call("cx_a", "get", "/kpis/")
    assert collection.status_code == 200
    nps = _kpis_by_code(collection.json())["NPS"]
    assert (nps["value"], nps["denominator"]) == (60.0, 5)

    individual = ctx.call("cx_a", "get", "/kpis/NPS", params={"agence_id": str(ctx.agence_a1)})
    assert individual.status_code == 200
    assert individual.json()["value"] == 50.0

    agency_manager = ctx.call("am_a1", "get", "/kpis/NPS")
    assert agency_manager.status_code == 200
    assert agency_manager.json()["value"] == 50.0

    forbidden = ctx.call("cx_a", "get", "/kpis/NPS", params={"agence_id": str(ctx.agence_b)})
    assert forbidden.status_code == 403
    org_b = ctx.call("cx_b", "get", "/kpis/NPS")
    assert org_b.status_code == 200
    assert org_b.json()["value"] == -100.0


def test_sla_in_collection_endpoint_individuel_et_rbac(ctx):
    collection = ctx.call("cx_a", "get", "/kpis/")
    assert collection.status_code == 200
    sla = _kpis_by_code(collection.json())["SLA_COMPLIANCE_RATE"]
    assert (sla["value"], sla["numerator"], sla["denominator"]) == (100.0, 1, 1)

    individual = ctx.call("cx_a", "get", "/kpis/SLA_COMPLIANCE_RATE", params={"agence_id": str(ctx.agence_a1)})
    assert individual.status_code == 200
    assert individual.json()["value"] == 100.0

    agency_manager = ctx.call("am_a1", "get", "/kpis/SLA_COMPLIANCE_RATE")
    assert (agency_manager.status_code, agency_manager.json()["value"]) == (200, 100.0)

    forbidden_agency = ctx.call("cx_a", "get", "/kpis/SLA_COMPLIANCE_RATE", params={"agence_id": str(ctx.agence_b)})
    assert forbidden_agency.status_code == 403
    org_b = ctx.call("cx_b", "get", "/kpis/SLA_COMPLIANCE_RATE")
    assert (org_b.status_code, org_b.json()["value"]) == (200, 0.0)


def test_escalation_rate_collection_endpoint_agence_et_rbac(ctx):
    collection = ctx.call("cx_a", "get", "/kpis/")
    assert collection.status_code == 200
    kpi = _kpis_by_code(collection.json())["ESCALATION_RATE"]
    assert (kpi["value"], kpi["numerator"], kpi["denominator"]) == (100.0, 1, 1)

    individual = ctx.call("cx_a", "get", "/kpis/ESCALATION_RATE", params={"agence_id": str(ctx.agence_a1)})
    assert (individual.status_code, individual.json()["value"]) == (200, 100.0)

    agency_manager = ctx.call("am_a1", "get", "/kpis/ESCALATION_RATE")
    assert (agency_manager.status_code, agency_manager.json()["value"]) == (200, 100.0)

    no_issue_agency = ctx.call("cx_a", "get", "/kpis/ESCALATION_RATE", params={"agence_id": str(ctx.agence_a2)})
    assert (no_issue_agency.status_code, no_issue_agency.json()["status"]) == (200, "no_data")

    forbidden_agency = ctx.call("cx_a", "get", "/kpis/ESCALATION_RATE", params={"agence_id": str(ctx.agence_b)})
    assert forbidden_agency.status_code == 403
    org_b = ctx.call("cx_b", "get", "/kpis/ESCALATION_RATE")
    assert (org_b.status_code, org_b.json()["value"], org_b.json()["numerator"], org_b.json()["denominator"]) == (200, 0.0, 0, 1)
    org_c = ctx.call("cx_c", "get", "/kpis/ESCALATION_RATE")
    assert (org_c.status_code, org_c.json()["status"], org_c.json()["value"]) == (200, "no_data", None)


@pytest.mark.parametrize("code", ["ISSUE_BACKLOG", "BACKLOG_AGE", "ACTION_COMPLETION_RATE", "SLA_COMPLIANCE_RATE", "ESCALATION_RATE"])
def test_nouveaux_kpis_individuels_rbac_et_collection(ctx, code):
    r = ctx.call("cx_a", "get", f"/kpis/{code}")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == code
    r_am = ctx.call("am_a1", "get", f"/kpis/{code}")
    assert r_am.status_code == 200, r_am.text
    r_forbidden = ctx.call("am_a1", "get", f"/kpis/{code}", params={"agence_id": str(ctx.agence_a2)})
    assert r_forbidden.status_code == 403


def test_kpi_individuel_insensible_a_la_casse(ctx):
    r = ctx.call("cx_a", "get", "/kpis/csat")
    assert r.status_code == 200
    assert r.json()["code"] == "CSAT"


def test_kpi_individuel_code_inconnu_404(ctx):
    r = ctx.call("cx_a", "get", "/kpis/UNKNOWN")
    assert r.status_code == 404


def test_kpi_individuel_respecte_le_filtre_agence(ctx):
    r = ctx.call("cx_a", "get", "/kpis/FEEDBACK_VOLUME", params={"agence_id": str(ctx.agence_a1)})
    assert r.json()["value"] == 4.0


def test_kpi_individuel_403_agence_hors_perimetre(ctx):
    r = ctx.call("am_a1", "get", "/kpis/CSAT", params={"agence_id": str(ctx.agence_a2)})
    assert r.status_code == 403


# ── Authentification / RBAC ────────────────────────────────────────────────────────

def test_non_authentifie_401(ctx):
    r = ctx.client.get("/kpis/")
    assert r.status_code == 401


def test_admin_exclu_403(ctx):
    """Principe RBAC fondateur : l'Admin n'a aucun accès aux données clients, y compris
    les KPI (dérivés de Feedback/Issue)."""
    r = ctx.call("admin", "get", "/kpis/")
    assert r.status_code == 403

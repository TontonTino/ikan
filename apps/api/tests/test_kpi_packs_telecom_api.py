"""
GET /kpis — périmètre réel du pack telecom (pas un pack injecté pour le test, le vrai
PACKS["telecom"]) : une organisation telecom voit le CX Core + NPS + les 3 KPI TEL_* (12),
jamais les 6 autres KPI bancaires (404 par code) ; une organisation banque ou autre ne voit
jamais les codes TEL_* (404 par code).
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-packs-telecom-api-0123456789")

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
from app.models.categorie import Categorie
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.issue_escalation import IssueEscalation
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.services.kpi.packs import COMMUNS

TEL_CODES = ("TEL_PART_HORS_PERIMETRE", "TEL_RECURRENCE_AGENCE", "TEL_RECURRENCE_HORS_PERIMETRE")
BANKING_SANS_NPS = ("ISSUE_BACKLOG", "BACKLOG_AGE", "ACTION_COMPLETION_RATE", "SLA_COMPLIANCE_RATE",
                    "ISSUE_RECURRENCE_RATE", "ESCALATION_RATE")
BANKING = ("NPS",) + BANKING_SANS_NPS


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__,
                Feedback.__table__, AnalyseIA.__table__, Issue.__table__, HistoriqueIssue.__table__,
                ActionCorrective.__table__, IssueEscalation.__table__, Categorie.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_telecom = Organisation(id=uuid4(), nom="Org Telecom", active=True, secteur_code="telecom")
    org_banque = Organisation(id=uuid4(), nom="Org Banque", active=True, secteur_code="banque")
    org_autre = Organisation(id=uuid4(), nom="Org Autre", active=True, secteur_code="autre")
    db.add_all([org_telecom, org_banque, org_autre])
    db.commit()
    ids = SimpleNamespace(org_telecom=org_telecom.id, org_banque=org_banque.id, org_autre=org_autre.id)
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
        "cx_telecom": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_telecom),
        "cx_banque": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_banque),
        "cx_autre": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_autre),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(call=call, **vars(ids))


def test_organisation_telecom_voit_cx_core_plus_nps_plus_le_pack(ctx):
    r = ctx.call("cx_telecom", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = {k["code"] for k in data["kpis"]}
    assert codes == set(COMMUNS) | {"NPS"} | set(TEL_CODES)
    assert len(data["kpis"]) == 8 + 1 + 3 == 12
    assert data["secteur_code"] == "telecom"
    assert data["pack_disponible"] is True
    sectoriels = {k["code"] for k in data["kpis"] if k["famille"] == "sectoriel"}
    assert sectoriels == {"NPS"} | set(TEL_CODES)
    assert not (codes & set(BANKING_SANS_NPS))


def test_organisation_banque_voit_cx_core_plus_les_7_bancaires_sans_tel(ctx):
    r = ctx.call("cx_banque", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = {k["code"] for k in data["kpis"]}
    assert codes == set(COMMUNS) | set(BANKING)
    assert len(data["kpis"]) == 8 + 7 == 15
    assert data["pack_disponible"] is True
    assert not (codes & set(TEL_CODES))


def test_organisation_autre_ne_voit_que_le_cx_core(ctx):
    r = ctx.call("cx_autre", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = {k["code"] for k in data["kpis"]}
    assert codes == set(COMMUNS)
    assert len(data["kpis"]) == 8
    assert data["pack_disponible"] is False
    assert not (codes & (set(TEL_CODES) | set(BANKING)))


@pytest.mark.parametrize("code", TEL_CODES)
@pytest.mark.parametrize("user_key", ["cx_banque", "cx_autre"])
def test_organisation_non_telecom_404_sur_les_codes_tel(ctx, user_key, code):
    r = ctx.call(user_key, "get", f"/kpis/{code}")
    assert r.status_code == 404
    r_inconnu = ctx.call(user_key, "get", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", code)


@pytest.mark.parametrize("code", TEL_CODES)
def test_organisation_telecom_accede_aux_codes_tel_par_leur_code(ctx, code):
    r = ctx.call("cx_telecom", "get", f"/kpis/{code}")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == code
    assert r.json()["status"] == "no_data"  # aucune Issue dans ce jeu de données minimal


@pytest.mark.parametrize("code", BANKING_SANS_NPS)
def test_organisation_telecom_404_sur_les_6_kpi_bancaires_hors_nps(ctx, code):
    """Les règles bancaires (délais, SLA, récurrence, escalades) ne sont pas transposées
    au telecom : 404, même message qu'un code inconnu."""
    r = ctx.call("cx_telecom", "get", f"/kpis/{code}")
    assert r.status_code == 404
    r_inconnu = ctx.call("cx_telecom", "get", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", code)


def test_organisation_telecom_accede_au_nps_par_son_code(ctx):
    r = ctx.call("cx_telecom", "get", "/kpis/NPS")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == "NPS"
    assert r.json()["famille"] == "sectoriel"
    assert r.json()["status"] == "no_data"  # aucune réponse NPS dans ce jeu de données minimal

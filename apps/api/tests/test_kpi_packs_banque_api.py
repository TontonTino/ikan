"""
GET /kpis — couches CX Core / extension Banking, sur le vrai registre PACKS (aucune
injection) :
- chaque secteur voit exactement ses codes : banque 8 + 7 = 15, telecom 8 + NPS + 3 = 12,
  sante / commerce / restauration / hotellerie / autre 8 ;
- un CX d'un secteur sans NPS reçoit 404 sur /kpis/NPS, même message qu'un code inconnu ;
- le NPS ouvert au telecom reste cloisonné par organisation et par agence (RBAC inchangé).

Les listes attendues sont écrites en dur (jamais relues depuis PACKS) : retirer un code
de packs.py doit faire échouer ces tests.
"""
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-packs-banque-api-0123456789")

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

NOW = datetime.now(timezone.utc)

CX_CORE = {
    "CSAT", "NEGATIVE_SENTIMENT_RATE", "FEEDBACK_VOLUME", "ISSUE_VOLUME",
    "CRITICAL_ISSUE_RATE", "ISSUE_RESOLUTION_RATE", "MEDIAN_RESOLUTION_TIME", "LOOP_CLOSURE_RATE",
}
BANKING = {
    "NPS", "ISSUE_BACKLOG", "BACKLOG_AGE", "ACTION_COMPLETION_RATE",
    "SLA_COMPLIANCE_RATE", "ISSUE_RECURRENCE_RATE", "ESCALATION_RATE",
}
TEL = {"TEL_PART_HORS_PERIMETRE", "TEL_RECURRENCE_AGENCE", "TEL_RECURRENCE_HORS_PERIMETRE"}

ATTENDU_PAR_SECTEUR = {
    "banque": CX_CORE | BANKING,
    "telecom": CX_CORE | {"NPS"} | TEL,
    "sante": CX_CORE,
    "commerce": CX_CORE,
    "restauration": CX_CORE,
    "hotellerie": CX_CORE,
    "autre": CX_CORE,
}
SECTEURS_SANS_NPS = ["sante", "commerce", "restauration", "hotellerie", "autre"]


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

    orgs = {secteur: Organisation(id=uuid4(), nom=f"Org {secteur}", active=True, secteur_code=secteur)
            for secteur in ATTENDU_PAR_SECTEUR}
    db.add_all(orgs.values())
    db.flush()

    # Telecom : 2 agences aux NPS opposés (agence 1 : 10 -> +100 ; agence 2 : 0 -> -100) ;
    # banque : 1 réponse NPS passive (7 -> 0). Valeurs distinctes pour détecter toute fuite.
    tel_1 = Agence(id=uuid4(), organisation_id=orgs["telecom"].id, nom="Telecom 1", active=True)
    tel_2 = Agence(id=uuid4(), organisation_id=orgs["telecom"].id, nom="Telecom 2", active=True)
    banque_1 = Agence(id=uuid4(), organisation_id=orgs["banque"].id, nom="Banque 1", active=True)
    db.add_all([tel_1, tel_2, banque_1])
    db.flush()
    for agence, nps in ((tel_1, 10), (tel_2, 0), (banque_1, 7)):
        qr = QRCode(id=uuid4(), agence_id=agence.id, code=f"QR-{agence.nom}", url="http://t", actif=True)
        db.add(qr)
        db.flush()
        db.add(Feedback(id=uuid4(), qr_code_id=qr.id, note=4, nps_note=nps, commentaire="x",
                        statut_traitement="nouveau", date_soumission=NOW))
    db.commit()

    ids = SimpleNamespace(
        orgs={s: o.id for s, o in orgs.items()},
        tel_1=tel_1.id, tel_2=tel_2.id, banque_1=banque_1.id,
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
        f"cx_{secteur}": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=org_id)
        for secteur, org_id in ids.orgs.items()
    }
    users["am_tel_1"] = SimpleNamespace(role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.tel_1,
                                        organisation_id=ids.orgs["telecom"])
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(call=call, **vars(ids))


@pytest.mark.parametrize("secteur", list(ATTENDU_PAR_SECTEUR))
def test_codes_visibles_exacts_par_secteur(ctx, secteur):
    r = ctx.call(f"cx_{secteur}", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = [k["code"] for k in data["kpis"]]
    assert set(codes) == ATTENDU_PAR_SECTEUR[secteur]
    assert len(codes) == len(ATTENDU_PAR_SECTEUR[secteur])  # aucun doublon
    assert data["secteur_code"] == secteur
    assert data["pack_disponible"] is (secteur in ("banque", "telecom"))


def test_effectifs_par_secteur():
    assert {s: len(c) for s, c in ATTENDU_PAR_SECTEUR.items()} == {
        "banque": 15, "telecom": 12, "sante": 8, "commerce": 8,
        "restauration": 8, "hotellerie": 8, "autre": 8,
    }


@pytest.mark.parametrize("secteur", list(ATTENDU_PAR_SECTEUR))
def test_familles_exposees(ctx, secteur):
    """CX Core en commun_prioritaire, tout KPI de pack (dont NPS et les 6 autres KPI
    bancaires) en sectoriel — c'est ce qui place les cartes dans les bonnes sections du
    dashboard (KpiCoreGrid.tsx), sans changement côté frontend."""
    r = ctx.call(f"cx_{secteur}", "get", "/kpis/")
    for k in r.json()["kpis"]:
        attendu = "commun_prioritaire" if k["code"] in CX_CORE else "sectoriel"
        assert k["famille"] == attendu, k["code"]


@pytest.mark.parametrize("secteur", SECTEURS_SANS_NPS)
def test_cx_dun_secteur_sans_nps_recoit_404_sur_nps_meme_message_quun_code_inconnu(ctx, secteur):
    r = ctx.call(f"cx_{secteur}", "get", "/kpis/NPS")
    assert r.status_code == 404
    r_inconnu = ctx.call(f"cx_{secteur}", "get", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r_inconnu.status_code == 404
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", "NPS")


@pytest.mark.parametrize("code", sorted(BANKING - {"NPS"}))
@pytest.mark.parametrize("secteur", ["telecom"] + SECTEURS_SANS_NPS)
def test_kpi_bancaire_hors_nps_404_hors_banque(ctx, secteur, code):
    r = ctx.call(f"cx_{secteur}", "get", f"/kpis/{code}")
    assert r.status_code == 404
    r_inconnu = ctx.call(f"cx_{secteur}", "get", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", code)


@pytest.mark.parametrize("code", sorted(BANKING))
def test_banque_accede_aux_7_kpi_bancaires_par_leur_code(ctx, code):
    r = ctx.call("cx_banque", "get", f"/kpis/{code}")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == code
    assert r.json()["famille"] == "sectoriel"


def test_nps_cloisonne_par_organisation(ctx):
    nps_tel = ctx.call("cx_telecom", "get", "/kpis/NPS").json()
    nps_banque = ctx.call("cx_banque", "get", "/kpis/NPS").json()
    assert (nps_tel["value"], nps_tel["denominator"]) == (0.0, 2)  # (+1 promoteur -1 détracteur) / 2
    assert (nps_banque["value"], nps_banque["denominator"]) == (0.0, 1)  # 1 passif
    collection_tel = {k["code"]: k for k in ctx.call("cx_telecom", "get", "/kpis/").json()["kpis"]}
    assert collection_tel["NPS"]["denominator"] == 2  # jamais la réponse de la banque


def test_nps_telecom_respecte_le_perimetre_agence(ctx):
    cx_filtre = ctx.call("cx_telecom", "get", "/kpis/NPS", params={"agence_id": str(ctx.tel_2)})
    assert (cx_filtre.status_code, cx_filtre.json()["value"]) == (200, -100.0)

    am = ctx.call("am_tel_1", "get", "/kpis/NPS")
    assert (am.status_code, am.json()["value"]) == (200, 100.0)  # forcé à sa propre agence

    am_autre_agence = ctx.call("am_tel_1", "get", "/kpis/NPS", params={"agence_id": str(ctx.tel_2)})
    assert am_autre_agence.status_code == 403

    cx_hors_org = ctx.call("cx_telecom", "get", "/kpis/NPS", params={"agence_id": str(ctx.banque_1)})
    assert cx_hors_org.status_code == 403

"""
Registre de packs KPI (app/services/kpi/packs.py) — invariants attendus par le rapport
d'audit KPI et la phase 1 :
- avec PACKS vide pour tous les secteurs (l'état réel aujourd'hui), aucune régression :
  tous les secteurs, y compris un secteur inconnu du registre ou None, voient exactement
  les 14 communs déjà calculés — jamais une exception.
- avec un pack injecté UNIQUEMENT dans un test (jamais dans PACKS réel), seule
  l'organisation du bon secteur voit son KPI dans la collection et peut l'obtenir par son
  code ; une autre organisation reçoit 404 sur ce code, identique à un code inconnu.

Harness identique à test_kpis_api.py (app FastAPI isolée n'incluant que kpis.router,
dependency_overrides, utilisateurs SimpleNamespace).
"""
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-packs-tests-0123456789")

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
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.issue_escalation import IssueEscalation
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.schemas.kpi import KPIResult
from app.services.kpi import packs
from app.services.kpi.definitions import KPI_DEFINITIONS
from app.services.kpi.engine import KPI_FUNCTIONS
from app.services.secteurs import SECTEUR_CODES

NOW = datetime.now(timezone.utc)


# ── Registre pur (pas de DB, pas d'API) ─────────────────────────────────────────

def test_communs_couvrent_exactement_les_15_kpi_actuels():
    """COMMUN_PRIORITAIRE + COMMUN_OPERATIONNEL = tous les KPI communs de definitions.py
    (hors famille sectorielle), ni plus ni moins. Si ce test casse après l'ajout d'un KPI :
    soit il manque une famille sur sa KPIDefinition, soit c'est un KPI sectoriel et ce test
    doit être mis à jour en toute connaissance de cause (pas un oubli)."""
    kpi_communs = {code for code, d in KPI_DEFINITIONS.items() if d.famille != "sectoriel"}
    assert set(packs.COMMUNS) == kpi_communs
    assert len(packs.COMMUN_PRIORITAIRE) == 8
    assert len(packs.COMMUN_OPERATIONNEL) == 7
    assert set(packs.COMMUN_PRIORITAIRE) & set(packs.COMMUN_OPERATIONNEL) == set()


@pytest.mark.parametrize("secteur_code", [c for c in SECTEUR_CODES if c != "telecom"] + [None, "code_vraiment_inconnu_du_registre"])
def test_kpis_visibles_sans_pack_renvoie_les_communs_seulement(secteur_code):
    """PACKS vide pour tous les secteurs sauf telecom (pack v1, voir test dédié
    ci-dessous) : aucune régression sur les autres, pas d'exception sur un secteur_code
    inconnu du registre ou None."""
    assert packs.kpis_visibles(secteur_code) == packs.COMMUNS


def test_kpis_visibles_telecom_ajoute_exactement_le_pack_v1():
    attendu = packs.COMMUNS + ("TEL_PART_HORS_PERIMETRE", "TEL_RECURRENCE_AGENCE", "TEL_RECURRENCE_HORS_PERIMETRE")
    assert packs.kpis_visibles("telecom") == attendu


def test_pack_sectoriel_accessible_vrai_pour_tous_les_forfaits_aujourdhui():
    """Décision produit pas encore prise (voir rapport d'audit KPI) : True pour tous."""
    assert all(packs.pack_sectoriel_accessible(p) for p in ("gratuit", "starter", "pro", "entreprise", None))


# ── API, avec un pack injecté uniquement dans le test ───────────────────────────

FAUX_KPI_BANQUE = "TEST_SECTORIEL_BANQUE"


def _faux_calculateur(db, organisation_id, agence_id=None, jours=30) -> KPIResult:
    return KPIResult(code=FAUX_KPI_BANQUE, label="Faux KPI banque (test)", unit="count", status="ok", value=1.0)


@pytest.fixture()
def ctx_packs():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    # Les 15 KPI communs réels sont aussi calculés (pas seulement le faux KPI injecté) :
    # toutes les tables qu'ils interrogent doivent exister, même vides.
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__,
                Feedback.__table__, AnalyseIA.__table__, Issue.__table__, HistoriqueIssue.__table__,
                ActionCorrective.__table__, IssueEscalation.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_banque = Organisation(id=uuid4(), nom="Org Banque", active=True, secteur_code="banque")
    org_autre = Organisation(id=uuid4(), nom="Org Autre", active=True, secteur_code="autre")
    db.add_all([org_banque, org_autre])
    db.commit()
    ids = SimpleNamespace(org_banque=org_banque.id, org_autre=org_autre.id)
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
        "cx_banque": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_banque),
        "cx_autre": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_autre),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(call=call, **vars(ids))


@pytest.fixture()
def pack_banque_injecte(monkeypatch):
    """Injecte un pack sectoriel UNIQUEMENT pour la durée du test — jamais dans le
    registre réel. monkeypatch restaure automatiquement PACKS/KPI_FUNCTIONS/KPI_DEFINITIONS
    après le test, y compris si celui-ci échoue."""
    monkeypatch.setitem(packs.PACKS, "banque", (FAUX_KPI_BANQUE,))
    monkeypatch.setitem(KPI_FUNCTIONS, FAUX_KPI_BANQUE, _faux_calculateur)
    from app.services.kpi.definitions import KPIDefinition, FAMILLE_SECTORIEL
    monkeypatch.setitem(
        KPI_DEFINITIONS, FAUX_KPI_BANQUE,
        KPIDefinition(code=FAUX_KPI_BANQUE, label="Faux KPI banque (test)", description="Test", unit="count",
                      famille=FAMILLE_SECTORIEL, secteur_code="banque"),
    )


def test_pack_injecte_visible_pour_le_bon_secteur_dans_la_collection(ctx_packs, pack_banque_injecte):
    r = ctx_packs.call("cx_banque", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = {k["code"] for k in data["kpis"]}
    assert FAUX_KPI_BANQUE in codes
    assert data["secteur_code"] == "banque"
    assert data["pack_disponible"] is True
    faux_kpi = next(k for k in data["kpis"] if k["code"] == FAUX_KPI_BANQUE)
    assert faux_kpi["famille"] == "sectoriel"


def test_pack_injecte_absent_de_la_collection_pour_un_autre_secteur(ctx_packs, pack_banque_injecte):
    r = ctx_packs.call("cx_autre", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = {k["code"] for k in data["kpis"]}
    assert FAUX_KPI_BANQUE not in codes
    assert data["pack_disponible"] is False
    # Les 14 communs restent inchangés pour ce secteur sans pack.
    assert codes == set(packs.COMMUNS)


def test_pack_injecte_accessible_par_code_pour_le_bon_secteur(ctx_packs, pack_banque_injecte):
    r = ctx_packs.call("cx_banque", "get", f"/kpis/{FAUX_KPI_BANQUE}")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == FAUX_KPI_BANQUE


def test_pack_injecte_404_par_code_pour_un_autre_secteur(ctx_packs, pack_banque_injecte):
    """404 — identique à un code totalement inconnu, jamais un 403 qui révélerait que ce
    KPI existe pour un autre secteur (voir le rapport d'audit KPI, section Sécurité)."""
    r = ctx_packs.call("cx_autre", "get", f"/kpis/{FAUX_KPI_BANQUE}")
    assert r.status_code == 404
    r_inconnu = ctx_packs.call("cx_autre", "get", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r_inconnu.status_code == 404
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", FAUX_KPI_BANQUE)


def test_sans_injection_le_faux_kpi_nexiste_nulle_part(ctx_packs):
    """Contrôle négatif : sans la fixture pack_banque_injecte, PACKS est le vrai registre
    (vide) — même l'organisation "banque" ne voit que les 14 communs."""
    r = ctx_packs.call("cx_banque", "get", "/kpis/")
    codes = {k["code"] for k in r.json()["kpis"]}
    assert codes == set(packs.COMMUNS)
    assert FAUX_KPI_BANQUE not in codes

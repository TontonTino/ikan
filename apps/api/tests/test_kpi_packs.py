"""
Registre de packs KPI (app/services/kpi/packs.py) — architecture en couches :
- CX Core (COMMUNS) : 8 KPI universels, visibles par TOUS les secteurs, y compris un
  secteur inconnu du registre ou None — jamais une exception.
- Extension Banking (PACKS["banque"]) : 7 KPI, famille sectorielle, secteur_code="banque".
- Extension Telecom (PACKS["telecom"]) : les 6 TEL_* + NPS (décision métier explicite) —
  jamais les 6 autres KPI bancaires.
- Extension Restauration (PACKS["restauration"]) : les 3 KPI RESTO_*.
- Les autres secteurs n'ont que le CX Core.
- Avec un pack injecté UNIQUEMENT dans un test (jamais dans PACKS réel), seule
  l'organisation du bon secteur voit son KPI dans la collection et peut l'obtenir par son
  code ; une autre organisation reçoit 404 sur ce code, identique à un code inconnu.

Les listes attendues sont écrites en dur ici (jamais relues depuis PACKS) : retirer ou
ajouter un code dans packs.py doit faire échouer ces tests.

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

CX_CORE = {
    "CSAT", "NEGATIVE_SENTIMENT_RATE", "FEEDBACK_VOLUME", "ISSUE_VOLUME",
    "CRITICAL_ISSUE_RATE", "ISSUE_RESOLUTION_RATE", "MEDIAN_RESOLUTION_TIME", "LOOP_CLOSURE_RATE",
}
BANKING = {
    "NPS", "ISSUE_BACKLOG", "BACKLOG_AGE", "ACTION_COMPLETION_RATE",
    "SLA_COMPLIANCE_RATE", "ISSUE_RECURRENCE_RATE", "ESCALATION_RATE",
}
BANKING_SANS_NPS = BANKING - {"NPS"}
TELECOM = {
    "TEL_PART_HORS_PERIMETRE", "TEL_RECURRENCE_AGENCE", "TEL_RECURRENCE_HORS_PERIMETRE", "NPS",
    "TEL_RECLAMATIONS_RESEAU", "TEL_RECLAMATIONS_RECHARGE_FORFAIT", "TEL_RECLAMATIONS_FACTURATION",
}
RESTAURATION = {"RESTO_TAUX_TRAITEMENT_RECONTACTS", "RESTO_RISQUE_SILENCIEUX", "RESTO_RECIDIVE_CATEGORIE"}
SECTEURS_SANS_PACK = [c for c in SECTEUR_CODES if c not in ("banque", "telecom", "restauration")] + [None, "code_vraiment_inconnu_du_registre"]


def test_communs_sont_exactement_les_8_kpi_cx_core():
    """COMMUNS = tous les KPI non sectoriels de definitions.py, ni plus ni moins, et ce
    sont exactement les 8 du CX Core. COMMUN_OPERATIONNEL est vide (famille conservée pour
    compatibilité). Si ce test casse après l'ajout d'un KPI : soit il manque une famille
    sur sa KPIDefinition, soit le CX Core a changé et ce test doit être mis à jour en toute
    connaissance de cause (pas un oubli)."""
    kpi_communs = {code for code, d in KPI_DEFINITIONS.items() if d.famille != "sectoriel"}
    assert set(packs.COMMUNS) == kpi_communs == CX_CORE
    assert set(packs.COMMUN_PRIORITAIRE) == CX_CORE
    assert len(packs.COMMUN_PRIORITAIRE) == 8
    assert packs.COMMUN_OPERATIONNEL == ()
    assert len(packs.COMMUNS) == 8


def test_les_7_kpi_bancaires_sont_identifies_comme_tels():
    for code in BANKING:
        d = KPI_DEFINITIONS[code]
        assert d.famille == "sectoriel", code
        assert d.secteur_code == "banque", code
    assert set(packs.PACKS["banque"]) == BANKING
    assert len(packs.PACKS["banque"]) == 7


def test_pack_telecom_est_exactement_les_6_tel_plus_nps():
    assert set(packs.PACKS["telecom"]) == TELECOM
    assert len(packs.PACKS["telecom"]) == 7
    assert not (set(packs.PACKS["telecom"]) & BANKING_SANS_NPS)


def test_chaque_code_de_pack_est_un_kpi_sectoriel_calculable():
    """Un code de pack doit exister dans KPI_DEFINITIONS (famille sectorielle) et avoir une
    fonction de calcul — sinon GET /kpis/ l'ignorerait silencieusement."""
    for secteur, codes in packs.PACKS.items():
        for code in codes:
            assert code in KPI_DEFINITIONS, (secteur, code)
            assert KPI_DEFINITIONS[code].famille == "sectoriel", (secteur, code)
            assert code in KPI_FUNCTIONS, (secteur, code)


@pytest.mark.parametrize("secteur_code", list(SECTEUR_CODES) + [None, "code_vraiment_inconnu_du_registre"])
def test_cx_core_visible_pour_tous_les_secteurs(secteur_code):
    assert CX_CORE <= set(packs.kpis_visibles(secteur_code))


@pytest.mark.parametrize("secteur_code", SECTEURS_SANS_PACK)
def test_kpis_visibles_sans_pack_renvoie_le_cx_core_seulement(secteur_code):
    """Pas d'exception sur un secteur_code inconnu du registre ou None, et jamais un KPI
    bancaire (NPS compris) pour un secteur qui n'a pas l'extension."""
    assert packs.kpis_visibles(secteur_code) == packs.COMMUNS
    assert set(packs.kpis_visibles(secteur_code)) == CX_CORE


def test_kpis_visibles_banque_cx_core_plus_les_7_bancaires():
    visibles = packs.kpis_visibles("banque")
    assert set(visibles) == CX_CORE | BANKING
    assert len(visibles) == 15
    assert visibles[:8] == packs.COMMUNS  # CX Core d'abord, puis le pack


def test_kpis_visibles_telecom_cx_core_plus_nps_plus_les_6_tel():
    visibles = packs.kpis_visibles("telecom")
    assert set(visibles) == CX_CORE | TELECOM
    assert len(visibles) == 15
    assert visibles[:8] == packs.COMMUNS
    assert not (set(visibles) & BANKING_SANS_NPS)


@pytest.mark.parametrize("secteur_code", [c for c in SECTEUR_CODES if c != "banque"] + [None])
def test_les_6_kpi_bancaires_hors_nps_jamais_visibles_hors_banque(secteur_code):
    assert not (set(packs.kpis_visibles(secteur_code)) & BANKING_SANS_NPS)


@pytest.mark.parametrize("secteur_code", list(SECTEUR_CODES) + [None])
def test_nps_visible_uniquement_pour_banque_et_telecom(secteur_code):
    assert ("NPS" in packs.kpis_visibles(secteur_code)) == (secteur_code in ("banque", "telecom"))


def test_pack_restauration_est_exactement_les_3_resto():
    assert set(packs.PACKS["restauration"]) == RESTAURATION
    assert len(packs.PACKS["restauration"]) == 3
    for code in RESTAURATION:
        assert KPI_DEFINITIONS[code].famille == "sectoriel"
        assert KPI_DEFINITIONS[code].secteur_code == "restauration"


def test_kpis_visibles_restauration_cx_core_plus_les_3_resto():
    visibles = packs.kpis_visibles("restauration")
    assert set(visibles) == CX_CORE | RESTAURATION
    assert len(visibles) == 11
    assert visibles[:8] == packs.COMMUNS


@pytest.mark.parametrize("secteur_code", [c for c in SECTEUR_CODES if c != "restauration"] + [None])
def test_kpi_resto_jamais_visibles_hors_restauration(secteur_code):
    assert not (set(packs.kpis_visibles(secteur_code)) & RESTAURATION)


def test_pack_sectoriel_accessible_vrai_pour_tous_les_forfaits_aujourdhui():
    """Décision produit pas encore prise (voir rapport d'audit KPI) : True pour tous."""
    assert all(packs.pack_sectoriel_accessible(p) for p in ("gratuit", "starter", "pro", "entreprise", None))


# ── API, avec un pack injecté uniquement dans le test ───────────────────────────

FAUX_KPI = "TEST_SECTORIEL_HOTELLERIE"


def _faux_calculateur(db, organisation_id, agence_id=None, jours=30) -> KPIResult:
    return KPIResult(code=FAUX_KPI, label="Faux KPI hotellerie (test)", unit="count", status="ok", value=1.0)


@pytest.fixture()
def ctx_packs():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    # Les KPI réels (CX Core, et pack banque pour l'organisation banque) sont aussi calculés
    # (pas seulement le faux KPI injecté) : toutes les tables qu'ils interrogent doivent
    # exister, même vides.
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__,
                Feedback.__table__, AnalyseIA.__table__, Issue.__table__, HistoriqueIssue.__table__,
                ActionCorrective.__table__, IssueEscalation.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_hotel = Organisation(id=uuid4(), nom="Org Hôtellerie", active=True, secteur_code="hotellerie")
    org_banque = Organisation(id=uuid4(), nom="Org Banque", active=True, secteur_code="banque")
    org_autre = Organisation(id=uuid4(), nom="Org Autre", active=True, secteur_code="autre")
    db.add_all([org_hotel, org_banque, org_autre])
    db.commit()
    ids = SimpleNamespace(org_hotel=org_hotel.id, org_banque=org_banque.id, org_autre=org_autre.id)
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
        "cx_hotel": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_hotel),
        "cx_banque": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_banque),
        "cx_autre": SimpleNamespace(role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_autre),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(call=call, **vars(ids))


@pytest.fixture()
def pack_hotellerie_injecte(monkeypatch):
    """Injecte un pack sectoriel UNIQUEMENT pour la durée du test — jamais dans le
    registre réel. monkeypatch restaure automatiquement PACKS/KPI_FUNCTIONS/KPI_DEFINITIONS
    après le test, y compris si celui-ci échoue. "hotellerie" n'a pas de pack réel : aucun
    vrai pack (banque, telecom, restauration) n'est jamais écrasé."""
    monkeypatch.setitem(packs.PACKS, "hotellerie", (FAUX_KPI,))
    monkeypatch.setitem(KPI_FUNCTIONS, FAUX_KPI, _faux_calculateur)
    from app.services.kpi.definitions import KPIDefinition, FAMILLE_SECTORIEL
    monkeypatch.setitem(
        KPI_DEFINITIONS, FAUX_KPI,
        KPIDefinition(code=FAUX_KPI, label="Faux KPI hotellerie (test)", description="Test", unit="count",
                      famille=FAMILLE_SECTORIEL, secteur_code="hotellerie"),
    )


def test_pack_injecte_visible_pour_le_bon_secteur_dans_la_collection(ctx_packs, pack_hotellerie_injecte):
    r = ctx_packs.call("cx_hotel", "get", "/kpis/")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = {k["code"] for k in data["kpis"]}
    assert codes == CX_CORE | {FAUX_KPI}
    assert data["secteur_code"] == "hotellerie"
    assert data["pack_disponible"] is True
    faux_kpi = next(k for k in data["kpis"] if k["code"] == FAUX_KPI)
    assert faux_kpi["famille"] == "sectoriel"


@pytest.mark.parametrize("user_key,attendu", [("cx_autre", CX_CORE), ("cx_banque", CX_CORE | BANKING)])
def test_pack_injecte_absent_de_la_collection_pour_un_autre_secteur(ctx_packs, pack_hotellerie_injecte, user_key, attendu):
    r = ctx_packs.call(user_key, "get", "/kpis/")
    assert r.status_code == 200, r.text
    codes = {k["code"] for k in r.json()["kpis"]}
    assert FAUX_KPI not in codes
    assert codes == attendu


def test_pack_injecte_accessible_par_code_pour_le_bon_secteur(ctx_packs, pack_hotellerie_injecte):
    r = ctx_packs.call("cx_hotel", "get", f"/kpis/{FAUX_KPI}")
    assert r.status_code == 200, r.text
    assert r.json()["code"] == FAUX_KPI


@pytest.mark.parametrize("user_key", ["cx_autre", "cx_banque"])
def test_pack_injecte_404_par_code_pour_un_autre_secteur(ctx_packs, pack_hotellerie_injecte, user_key):
    """404 — identique à un code totalement inconnu, jamais un 403 qui révélerait que ce
    KPI existe pour un autre secteur (voir le rapport d'audit KPI, section Sécurité)."""
    r = ctx_packs.call(user_key, "get", f"/kpis/{FAUX_KPI}")
    assert r.status_code == 404
    r_inconnu = ctx_packs.call(user_key, "get", "/kpis/CE_CODE_N_EXISTE_PAS")
    assert r_inconnu.status_code == 404
    assert r.json()["detail"] == r_inconnu.json()["detail"].replace("CE_CODE_N_EXISTE_PAS", FAUX_KPI)


def test_sans_injection_le_faux_kpi_nexiste_nulle_part(ctx_packs):
    """Contrôle négatif : sans la fixture pack_hotellerie_injecte, PACKS est le vrai
    registre — "hotellerie" n'y a pas de pack et ne voit que le CX Core."""
    r = ctx_packs.call("cx_hotel", "get", "/kpis/")
    codes = {k["code"] for k in r.json()["kpis"]}
    assert codes == CX_CORE
    assert r.json()["pack_disponible"] is False
    assert FAUX_KPI not in codes

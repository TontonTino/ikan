"""
Exactitude des données, temporalité et transparence IA — non-régression 5B-2.

- Tendances : 0 → N n'est pas « +100 % », l'écart entre deux taux s'exprime en points.
- Absence de données : un taux sans observation vaut None / status "no_data", jamais 0.
- Semaines : clé ISO « AAAA-Www », tri chronologique, aucune fusion inter-années.
- Cohérence : le CSAT des dashboards et statistiques est celui du moteur KPI, et la prise
  en charge a la même définition pour la période courante et la précédente.
- Transparence : les insights et recommandations calculés par règles portent source="regle".

Les tests d'endpoints passent par le VRAI routeur et la VRAIE authentification JWT, sur
une base SQLite en mémoire (même montage que test_isolation_multi_org.py).
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-data-correctness-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (enregistre tous les modèles)
from app.api.v1.endpoints import dashboard, recommandations
from app.api.v1.endpoints.dashboard import _compute_tendances
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, PriorityLevel, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.recommandation import Recommandation
from app.models.utilisateur import Utilisateur
from app.schemas.dashboard import DashboardSiege
from app.services.dashboard_helpers import (
    _calc_kpi_trend,
    _cle_semaine_iso,
    _est_traite,
    _libelles_semaines,
    _taux,
)
from app.services.kpi.engine import calculer_csat


# ── Tendances ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("prev, curr, attendu", [
    (0, 0, None),          # rien à comparer
    (0, 20, None),         # 0 → N : pas de base, jamais « +100 % »
    (10, 0, "-100.0%"),    # baisse réelle
    (10, 20, "+100.0%"),
    (20, 10, "-50.0%"),
    (20, 20, "+0.0%"),
])
def test_tendance_volumes(prev, curr, attendu):
    assert _calc_kpi_trend(curr, prev)[0] == attendu


def test_tendance_volume_valence():
    assert _calc_kpi_trend(20, 10) == ("+100.0%", True)
    assert _calc_kpi_trend(10, 20) == ("-50.0%", False)
    # Pour un indicateur « moins c'est mieux » (avis négatifs, critiques), une baisse est favorable.
    assert _calc_kpi_trend(10, 20, invert_positive=True) == ("-50.0%", True)


def test_tendance_taux_en_points():
    assert _calc_kpi_trend(70.0, 80.0, is_pct_diff=True) == ("-10.0 pts", False)
    assert _calc_kpi_trend(80.0, 70.0, is_pct_diff=True) == ("+10.0 pts", True)
    assert _calc_kpi_trend(50.0, 50.0, is_pct_diff=True) == ("+0.0 pts", True)
    # Un taux à 0 % mesuré est une vraie valeur : l'écart se calcule.
    assert _calc_kpi_trend(0.0, 40.0, is_pct_diff=True) == ("-40.0 pts", False)


def test_tendance_taux_sans_donnees():
    assert _calc_kpi_trend(None, 80.0, is_pct_diff=True) == (None, True)
    assert _calc_kpi_trend(80.0, None, is_pct_diff=True) == (None, True)
    assert _calc_kpi_trend(None, None, is_pct_diff=True) == (None, True)


def test_taux_sans_observation_vaut_none():
    assert _taux(0, 0) is None
    assert _taux(0, 4) == 0.0
    assert _taux(1, 3) == 33.3


def test_evolution_taux_resolution_supprimee():
    assert "evolution_taux_resolution" not in DashboardSiege.model_fields
    assert "evolution_taux_resolution_positive" not in DashboardSiege.model_fields


# ── Semaines ISO ─────────────────────────────────────────────────────────────────

def test_cle_semaine_iso_passage_d_annee():
    assert _cle_semaine_iso(datetime(2025, 12, 22)) == "2025-W52"
    # Le lundi 29/12/2025 appartient à la semaine 1 de l'année ISO 2026.
    assert _cle_semaine_iso(datetime(2025, 12, 29)) == "2026-W01"
    assert _cle_semaine_iso(datetime(2026, 1, 5)) == "2026-W02"
    assert sorted(["2026-W01", "2025-W52", "2026-W02"]) == ["2025-W52", "2026-W01", "2026-W02"]


def test_libelles_semaines():
    assert _libelles_semaines(["2026-W09", "2026-W10"]) == {"2026-W09": "Sem 9", "2026-W10": "Sem 10"}
    # Deux années ISO : l'année est ajoutée pour lever l'ambiguïté.
    assert _libelles_semaines(["2025-W52", "2026-W01"]) == {"2025-W52": "Sem 52 2025", "2026-W01": "Sem 1 2026"}


def _fb(dt, note):
    return SimpleNamespace(date_soumission=dt, note=note)


def test_tendances_hebdo_chronologiques_sans_fusion_inter_annees():
    feedbacks = [
        _fb(datetime(2026, 1, 6), 5),     # 2026-W02
        _fb(datetime(2025, 12, 23), 1),   # 2025-W52
        _fb(datetime(2025, 12, 30), 5),   # 2026-W01
        _fb(datetime(2025, 3, 4), 5),     # 2025-W10
        _fb(datetime(2026, 3, 3), 1),     # 2026-W10 — même numéro, autre année
    ]
    tendances = _compute_tendances(feedbacks, jours=365)
    assert [t.date for t in tendances] == [
        "Semaine 10 2025", "Semaine 52 2025", "Semaine 1 2026", "Semaine 2 2026", "Semaine 10 2026",
    ]
    assert [t.taux for t in tendances] == [100.0, 0.0, 100.0, 100.0, 0.0]
    assert all(t.nombre_feedbacks == 1 for t in tendances)


def test_tendances_journalieres_inchangees():
    tendances = _compute_tendances([_fb(datetime(2026, 3, 2), 5), _fb(datetime(2026, 3, 1), 1)], jours=30)
    assert [t.date for t in tendances] == ["2026-03-01", "2026-03-02"]


# ── Prise en charge : définition unique ──────────────────────────────────────────

def test_est_traite_meme_definition():
    analyses = {"f-analyse"}
    assert _est_traite(SimpleNamespace(id="x", statut_traitement="en_cours"), analyses)
    assert _est_traite(SimpleNamespace(id="f-analyse", statut_traitement="nouveau"), analyses)
    assert not _est_traite(SimpleNamespace(id="y", statut_traitement="nouveau"), analyses)


# ── Endpoints ────────────────────────────────────────────────────────────────────

@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL, non utilisées ici
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
    app.include_router(recommandations.router, prefix="/recommandations")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    org = Organisation(id=uuid4(), nom="Client A", active=True)
    org_vide = Organisation(id=uuid4(), nom="Client sans avis", active=True)
    db.add_all([org, org_vide]); db.flush()

    a1 = Agence(id=uuid4(), organisation_id=org.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    v1 = Agence(id=uuid4(), organisation_id=org_vide.id, nom="Agence V1", ville="Nice", active=True, seuil_alerte=70)
    db.add_all([a1, a2, v1]); db.flush()

    qr = {}
    for agence in (a1, a2, v1):
        qr[agence.id] = QRCode(id=uuid4(), agence_id=agence.id, code=f"QR-{agence.nom}", url="http://t", actif=True)
    db.add_all(qr.values()); db.flush()

    def user(role, organisation, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=organisation.id, agence_id=agence.id if agence else None,
                        nom="N", prenom="P", email=f"{uuid4().hex[:10]}@test.io",
                        mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    cx = user(UserRole.CX_MANAGER, org)
    cx_vide = user(UserRole.CX_MANAGER, org_vide)
    am_vide = user(UserRole.AGENCY_MANAGER, org_vide, v1)
    db.commit()

    ids = SimpleNamespace(org=org.id, org_vide=org_vide.id, a1=a1.id, a2=a2.id, v1=v1.id,
                          qr={k: v.id for k, v in qr.items()}, cx=cx.id, cx_vide=cx_vide.id, am_vide=am_vide.id)
    db.close()

    entete = lambda user_id: {"Authorization": f"Bearer {create_access_token(user_id)}"}  # noqa: E731
    return SimpleNamespace(client=TestClient(app), H=entete, Session=Session, **vars(ids))


def _feedback(db, qr_id, note, jours_avant=1, statut="nouveau", analyse=None):
    fb = Feedback(id=uuid4(), qr_code_id=qr_id, note=note, commentaire="avis", statut_traitement=statut,
                  date_soumission=datetime.now(timezone.utc) - timedelta(days=jours_avant))
    db.add(fb); db.flush()
    if analyse:
        a = AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF, criticite=analyse,
                      score_sentiment=0.1, theme_principal="attente")
        db.add(a); db.flush()
        return fb, a
    return fb, None


def _get(c, user, url):
    r = c.client.get(url, headers=c.H(user))
    assert r.status_code == 200, r.text
    return r.json()


# -- Aucun avis : null / no_data, jamais 0 --

def test_dashboard_agence_sans_avis(ctx):
    data = _get(ctx, ctx.am_vide, f"/dashboard/agence/{ctx.v1}")
    assert data["taux_satisfaction"] is None
    assert data["taux_prise_en_charge"] is None
    assert data["tendances"] == []


def test_dashboard_siege_sans_avis(ctx):
    data = _get(ctx, ctx.cx_vide, "/dashboard/siege")
    assert data["taux_satisfaction_global"] is None
    assert data["evolution_satisfaction"] is None
    assert all(a["taux_satisfaction"] is None for a in data["agences"])
    assert "evolution_taux_resolution" not in data


def test_statistics_cx_sans_avis(ctx):
    data = _get(ctx, ctx.cx_vide, "/dashboard/statistics/cx")
    for code in ("satisfaction", "taux_traitement"):
        kpi = data["kpis"][code]
        assert kpi["status"] == "no_data"
        assert kpi["valeur"] is None and kpi["valeur_num"] is None
        assert kpi["valeur_precedente"] is None and kpi["evolution"] is None
    # Un volume nul est une vraie mesure.
    assert data["kpis"]["total_feedbacks"]["status"] == "ok"
    assert data["kpis"]["total_feedbacks"]["valeur"] == 0
    assert data["kpis"]["total_feedbacks"]["evolution"] is None   # 0 → 0
    assert all(a["satisfaction_rate"] is None and a["taux_traitement"] is None for a in data["agences_ranking"])
    assert data["insights_ia"] == []   # aucun constat inventé sans données


def test_statistics_agency_sans_avis(ctx):
    data = _get(ctx, ctx.am_vide, "/dashboard/statistics/agency")
    assert data["kpis"]["satisfaction"]["status"] == "no_data"
    assert data["kpis"]["satisfaction"]["valeur"] is None
    assert data["kpis"]["taux_traitement"]["status"] == "no_data"
    assert data["insights_ia"] == []


# -- 0 → N : pas de « +100 % » --

def test_statistics_cx_periode_precedente_vide(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr[ctx.a1], 5)
    _feedback(db, ctx.qr[ctx.a1], 1)
    db.commit(); db.close()
    kpis = _get(ctx, ctx.cx, "/dashboard/statistics/cx")["kpis"]
    assert kpis["satisfaction"]["status"] == "ok"
    assert kpis["satisfaction"]["valeur"] == "50.0%"
    assert kpis["satisfaction"]["valeur_precedente"] is None
    assert kpis["satisfaction"]["evolution"] is None
    assert kpis["total_feedbacks"]["evolution"] is None


def test_statistics_cx_ecart_satisfaction_en_points(ctx):
    db = ctx.Session()
    for note in (5, 5, 1, 1):          # période précédente : 50 %
        _feedback(db, ctx.qr[ctx.a1], note, jours_avant=40)
    for note in (5, 5, 5, 1):          # période courante : 75 %
        _feedback(db, ctx.qr[ctx.a1], note)
    db.commit(); db.close()
    kpis = _get(ctx, ctx.cx, "/dashboard/statistics/cx")["kpis"]
    assert kpis["satisfaction"]["evolution"] == "+25.0 pts"
    assert kpis["total_feedbacks"]["evolution"] == "+0.0%"


# -- Cohérence CSAT avec le moteur KPI --

def test_csat_coherent_avec_le_moteur_kpi(ctx):
    db = ctx.Session()
    for note in (5, 4, 3, 1, 2, 5):
        _feedback(db, ctx.qr[ctx.a1], note)
    for note in (1, 1, 4):
        _feedback(db, ctx.qr[ctx.a2], note)
    db.commit()
    csat_org = calculer_csat(db, ctx.org, jours=30).value
    csat_a1 = calculer_csat(db, ctx.org, agence_id=ctx.a1, jours=30).value
    db.close()

    assert _get(ctx, ctx.cx, "/dashboard/statistics/cx")["kpis"]["satisfaction"]["valeur_num"] == csat_org
    assert _get(ctx, ctx.cx, "/dashboard/siege")["taux_satisfaction_global"] == csat_org
    assert _get(ctx, ctx.cx, f"/dashboard/agence/{ctx.a1}")["taux_satisfaction"] == csat_a1
    agency = _get(ctx, ctx.cx, f"/dashboard/statistics/agency?agence_id={ctx.a1}")
    assert agency["kpis"]["satisfaction"]["valeur_num"] == csat_a1


def test_csat_sans_avis_coherent_avec_le_moteur_kpi(ctx):
    db = ctx.Session()
    r = calculer_csat(db, ctx.org_vide, jours=30)
    db.close()
    assert r.status == "no_data" and r.value is None
    kpi = _get(ctx, ctx.cx_vide, "/dashboard/statistics/cx")["kpis"]["satisfaction"]
    assert (kpi["status"], kpi["valeur_num"]) == (r.status, r.value)


# -- Prise en charge : même définition sur les deux périodes --

def test_prise_en_charge_meme_definition_deux_periodes(ctx):
    db = ctx.Session()
    for jours_avant in (40, 1):   # même composition sur les deux périodes
        _feedback(db, ctx.qr[ctx.a1], 4, jours_avant, statut="en_cours")                      # traité (statut)
        _feedback(db, ctx.qr[ctx.a1], 2, jours_avant, analyse=CriticiteType.FAIBLE)            # traité (analyse)
        _feedback(db, ctx.qr[ctx.a1], 3, jours_avant)                                          # non traité
    db.commit(); db.close()
    for url in ("/dashboard/statistics/cx", f"/dashboard/statistics/agency?agence_id={ctx.a1}"):
        kpis = _get(ctx, ctx.cx, url)["kpis"]
        assert kpis["feedbacks_traites"]["valeur"] == 2
        assert kpis["feedbacks_traites"]["valeur_precedente"] == 2
        assert kpis["taux_traitement"]["valeur_num"] == 66.7
        assert kpis["taux_traitement"]["valeur_precedente"] == 66.7
        assert kpis["taux_traitement"]["evolution"] == "+0.0 pts"


# -- Semaines : clés ISO dans les séries des statistiques --

def test_statistics_series_hebdo_iso(ctx):
    db = ctx.Session()
    for jours_avant in (80, 50, 20, 2):
        _feedback(db, ctx.qr[ctx.a1], 5, jours_avant)
    db.commit(); db.close()
    serie = _get(ctx, ctx.cx, "/dashboard/statistics/cx?jours=90")["evolution_satisfaction"]
    cles = [p["date"] for p in serie]
    assert cles == sorted(cles) and len(cles) == 4
    assert all(len(k) == 8 and k[4:6] == "-W" for k in cles)
    assert all(p["label"].startswith("Sem ") for p in serie)


# -- Transparence : origine des insights et recommandations --

def test_insights_statistiques_source_regle(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr[ctx.a1], 5)
    _feedback(db, ctx.qr[ctx.a1], 1, analyse=CriticiteType.CRITIQUE)
    db.commit(); db.close()
    insights = _get(ctx, ctx.cx, "/dashboard/statistics/cx")["insights_ia"]
    assert insights and all(i["source"] == "regle" for i in insights)
    textes = " ".join(i["titre"] + " " + i["description"] for i in insights)
    assert "NPS" not in textes

    agency = _get(ctx, ctx.cx, f"/dashboard/statistics/agency?agence_id={ctx.a1}")["insights_ia"]
    assert agency and all(i["source"] == "regle" for i in agency)
    assert not any("accueil & fluidité" in i["titre"] for i in agency)


def test_recommandations_source_regle(ctx):
    db = ctx.Session()
    _, analyse = _feedback(db, ctx.qr[ctx.a1], 1, analyse=CriticiteType.CRITIQUE)
    db.add(Recommandation(id=uuid4(), analyse_ia_id=analyse.id, contenu="Rappeler le client sous 24 h.",
                          priorite=PriorityLevel.HIGH, date_generation=datetime.now(timezone.utc)))
    db.commit(); db.close()

    insights = _get(ctx, ctx.cx, f"/dashboard/statistics/agency?agence_id={ctx.a1}")["insights_ia"]
    reco = [i for i in insights if i["description"] == "Rappeler le client sous 24 h."]
    assert len(reco) == 1
    assert reco[0]["source"] == "regle" and reco[0]["titre"] == "Recommandation automatique"

    liste = _get(ctx, ctx.cx, f"/recommandations/agences/{ctx.a1}")
    assert liste and all(r["source"] == "regle" for r in liste)

"""
KPI Engine (app/services/kpi/) — calculs des 8 KPI P0. Base SQLite en mémoire (comme
test_issues.py). Insertion directe des entités (Feedback, AnalyseIA, Issue) : ce sont des
tests de calcul, pas de permissions d'endpoint (déjà couvertes par test_issues.py) — voir
test_kpi_security.py pour l'isolation organisation/agence du moteur lui-même.
"""
import os
import statistics
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-tests-0123456789")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.services.kpi.engine import (
    calculer_critical_issue_rate,
    calculer_csat,
    calculer_feedback_volume,
    calculer_issue_resolution_rate,
    calculer_issue_volume,
    calculer_loop_closure_rate,
    calculer_median_resolution_time,
    calculer_negative_sentiment_rate,
)

NOW = datetime.now(timezone.utc)


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__,
                Feedback.__table__, AnalyseIA.__table__, Issue.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_a = Organisation(id=uuid4(), nom="Org A", active=True)
    db.add(org_a)
    db.flush()

    agence_a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", active=True)
    agence_a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", active=True)
    db.add_all([agence_a1, agence_a2])
    db.flush()

    qr_a1 = QRCode(id=uuid4(), agence_id=agence_a1.id, code="QR-A1", url="http://t/a1", actif=True)
    qr_a2 = QRCode(id=uuid4(), agence_id=agence_a2.id, code="QR-A2", url="http://t/a2", actif=True)
    db.add_all([qr_a1, qr_a2])
    db.commit()

    ids = SimpleNamespace(org_a=org_a.id, agence_a1=agence_a1.id, agence_a2=agence_a2.id, qr_a1=qr_a1.id, qr_a2=qr_a2.id)
    return SimpleNamespace(Session=Session, **vars(ids))


def _feedback(db, qr_id, note, sentiment=None, criticite=None, jours_avant=0):
    fb = Feedback(
        id=uuid4(), qr_code_id=qr_id, note=note, commentaire="x", statut_traitement="nouveau",
        date_soumission=NOW - timedelta(days=jours_avant),
    )
    db.add(fb)
    db.flush()
    if sentiment is not None:
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment, criticite=criticite or CriticiteType.FAIBLE, score_sentiment=0.5))
    return fb


def _issue(db, organisation_id, agence_id, statut="ouverte", severite=CriticiteType.FAIBLE,
           necessite_action=False, jours_detection_avant=0, premiere_detection=None, date_resolution=None):
    issue = Issue(
        id=uuid4(), organisation_id=organisation_id, agence_id=agence_id, titre="Issue test",
        statut=statut, severite=severite, necessite_action=necessite_action,
        premiere_detection=premiere_detection or (NOW - timedelta(days=jours_detection_avant)),
        date_resolution=date_resolution,
    )
    db.add(issue)
    return issue


# ── CSAT ──────────────────────────────────────────────────────────────────────────

def test_csat_positifs_et_negatifs(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr_a1, note=5)
    _feedback(db, ctx.qr_a1, note=4)
    _feedback(db, ctx.qr_a1, note=3)
    _feedback(db, ctx.qr_a1, note=1)
    db.commit()
    r = calculer_csat(db, ctx.org_a)
    assert r.status == "ok"
    assert (r.numerator, r.denominator, r.value) == (2, 4, 50.0)
    db.close()


def test_csat_aucun_feedback_no_data(ctx):
    db = ctx.Session()
    r = calculer_csat(db, ctx.org_a)
    assert r.status == "no_data"
    assert r.value is None
    db.close()


def test_csat_filtre_agence(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr_a1, note=5)
    _feedback(db, ctx.qr_a1, note=5)
    _feedback(db, ctx.qr_a2, note=1)
    db.commit()
    r = calculer_csat(db, ctx.org_a, agence_id=ctx.agence_a1)
    assert (r.numerator, r.denominator, r.value) == (2, 2, 100.0)
    db.close()


def test_csat_periode(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr_a1, note=5, jours_avant=1)
    _feedback(db, ctx.qr_a1, note=1, jours_avant=60)  # hors période 30j
    db.commit()
    r = calculer_csat(db, ctx.org_a, jours=30)
    assert (r.numerator, r.denominator) == (1, 1)
    db.close()


# ── Negative Sentiment Rate ────────────────────────────────────────────────────────

def test_sentiment_positif_neutre_negatif_non_analyse(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr_a1, note=5, sentiment=SentimentType.POSITIF)
    _feedback(db, ctx.qr_a1, note=3, sentiment=SentimentType.NEUTRE)
    _feedback(db, ctx.qr_a1, note=1, sentiment=SentimentType.NEGATIF)
    _feedback(db, ctx.qr_a1, note=2, sentiment=None)  # jamais analysé -> exclu
    db.commit()
    r = calculer_negative_sentiment_rate(db, ctx.org_a)
    assert r.status == "ok"
    assert (r.numerator, r.denominator) == (1, 3)  # le non-analysé n'entre pas dans le denominateur
    assert r.value == round(1 / 3 * 100, 1)
    db.close()


def test_sentiment_aucune_analyse_no_data(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr_a1, note=3, sentiment=None)
    db.commit()
    r = calculer_negative_sentiment_rate(db, ctx.org_a)
    assert r.status == "no_data"
    db.close()


# ── Feedback Volume ────────────────────────────────────────────────────────────────

def test_feedback_volume(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr_a1, note=5)
    _feedback(db, ctx.qr_a1, note=3)
    _feedback(db, ctx.qr_a2, note=1)
    db.commit()
    assert calculer_feedback_volume(db, ctx.org_a).value == 3.0
    assert calculer_feedback_volume(db, ctx.org_a, agence_id=ctx.agence_a1).value == 2.0
    db.close()


def test_feedback_volume_zero_est_ok_pas_no_data(ctx):
    db = ctx.Session()
    r = calculer_feedback_volume(db, ctx.org_a)
    assert r.status == "ok"
    assert r.value == 0.0
    db.close()


def test_feedback_volume_periode(ctx):
    db = ctx.Session()
    _feedback(db, ctx.qr_a1, note=5, jours_avant=5)
    _feedback(db, ctx.qr_a1, note=5, jours_avant=90)
    db.commit()
    assert calculer_feedback_volume(db, ctx.org_a, jours=30).value == 1.0
    db.close()


# ── Issue Volume ───────────────────────────────────────────────────────────────────

def test_issue_volume_plusieurs_feedbacks_meme_issue_compte_pour_un(ctx):
    db = ctx.Session()
    issue = _issue(db, ctx.org_a, ctx.agence_a1)
    db.flush()
    for _ in range(5):
        fb = _feedback(db, ctx.qr_a1, note=1)
        fb.issue_id = issue.id
    db.commit()
    assert calculer_issue_volume(db, ctx.org_a).value == 1.0
    db.close()


def test_issue_volume_plusieurs_issues(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1)
    _issue(db, ctx.org_a, ctx.agence_a1)
    _issue(db, ctx.org_a, ctx.agence_a2)
    db.commit()
    assert calculer_issue_volume(db, ctx.org_a).value == 3.0
    db.close()


def test_issue_volume_filtre_agence(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1)
    _issue(db, ctx.org_a, ctx.agence_a2)
    db.commit()
    assert calculer_issue_volume(db, ctx.org_a, agence_id=ctx.agence_a1).value == 1.0
    db.close()


def test_issue_volume_periode(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, jours_detection_avant=5)
    _issue(db, ctx.org_a, ctx.agence_a1, jours_detection_avant=90)
    db.commit()
    assert calculer_issue_volume(db, ctx.org_a, jours=30).value == 1.0
    db.close()


# ── Critical Issue Rate ─────────────────────────────────────────────────────────────

def test_critical_issue_rate(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, severite=CriticiteType.CRITIQUE)
    _issue(db, ctx.org_a, ctx.agence_a1, severite=CriticiteType.FAIBLE)
    _issue(db, ctx.org_a, ctx.agence_a1, severite=CriticiteType.ELEVEE)  # ne compte PAS (ELEVEE != CRITIQUE)
    db.commit()
    r = calculer_critical_issue_rate(db, ctx.org_a)
    assert (r.numerator, r.denominator) == (1, 3)
    db.close()


def test_critical_issue_rate_aucune_donnee(ctx):
    db = ctx.Session()
    r = calculer_critical_issue_rate(db, ctx.org_a)
    assert r.status == "no_data"
    db.close()


def test_critical_issue_rate_filtre_agence(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, severite=CriticiteType.CRITIQUE)
    _issue(db, ctx.org_a, ctx.agence_a2, severite=CriticiteType.FAIBLE)
    db.commit()
    r = calculer_critical_issue_rate(db, ctx.org_a, agence_id=ctx.agence_a1)
    assert (r.numerator, r.denominator, r.value) == (1, 1, 100.0)
    db.close()


# ── Issue Resolution Rate ────────────────────────────────────────────────────────────

def test_issue_resolution_rate_scenario_utilisateur(ctx):
    """1 ouverte, 1 action_en_cours, 1 resolue, 1 verifiee, 1 reouverte -> numerateur = 2."""
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, statut="ouverte")
    _issue(db, ctx.org_a, ctx.agence_a1, statut="action_en_cours")
    _issue(db, ctx.org_a, ctx.agence_a1, statut="resolue", date_resolution=NOW)
    _issue(db, ctx.org_a, ctx.agence_a1, statut="verifiee", date_resolution=NOW)
    _issue(db, ctx.org_a, ctx.agence_a1, statut="reouverte", date_resolution=NOW)  # resolue par le passe, plus maintenant
    db.commit()
    r = calculer_issue_resolution_rate(db, ctx.org_a)
    assert (r.numerator, r.denominator) == (2, 5)
    assert r.value == 40.0
    db.close()


def test_issue_resolution_rate_reouverte_exclue(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, statut="reouverte", date_resolution=NOW)
    db.commit()
    r = calculer_issue_resolution_rate(db, ctx.org_a)
    assert (r.numerator, r.denominator) == (0, 1)
    db.close()


def test_issue_resolution_rate_periode(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, statut="resolue", date_resolution=NOW, jours_detection_avant=5)
    _issue(db, ctx.org_a, ctx.agence_a1, statut="ouverte", jours_detection_avant=90)
    db.commit()
    r = calculer_issue_resolution_rate(db, ctx.org_a, jours=30)
    assert (r.numerator, r.denominator) == (1, 1)
    db.close()


# ── Median Resolution Time ───────────────────────────────────────────────────────────

def test_median_est_bien_une_mediane_pas_une_moyenne(ctx):
    db = ctx.Session()
    durees = [1, 3, 20]  # heures ; mediane = 3, moyenne = 8.0
    for h in durees:
        detection = NOW - timedelta(hours=h)
        _issue(db, ctx.org_a, ctx.agence_a1, statut="resolue", premiere_detection=detection, date_resolution=NOW)
    db.commit()
    r = calculer_median_resolution_time(db, ctx.org_a)
    assert r.status == "ok"
    assert r.value == pytest.approx(statistics.median(durees), abs=0.05)
    assert r.value != pytest.approx(statistics.mean(durees), abs=0.5)
    db.close()


def test_median_aucune_issue_resolue_no_data(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, statut="ouverte")
    db.commit()
    r = calculer_median_resolution_time(db, ctx.org_a)
    assert r.status == "no_data"
    assert r.value is None
    db.close()


def test_median_issue_non_resolue_exclue(ctx):
    db = ctx.Session()
    detection = NOW - timedelta(hours=5)
    _issue(db, ctx.org_a, ctx.agence_a1, statut="resolue", premiere_detection=detection, date_resolution=NOW)
    _issue(db, ctx.org_a, ctx.agence_a1, statut="ouverte")  # pas de date_resolution -> exclue
    db.commit()
    r = calculer_median_resolution_time(db, ctx.org_a)
    assert r.denominator == 1
    assert r.value == pytest.approx(5.0, abs=0.05)
    db.close()


# ── Loop Closure Rate ─────────────────────────────────────────────────────────────────

def test_loop_closure_rate_scenario_utilisateur(ctx):
    """10 Issues necessite_action=true : 6 verifiees, 2 resolues, 1 action_en_cours, 1 ouverte -> 60%."""
    db = ctx.Session()
    for _ in range(6):
        _issue(db, ctx.org_a, ctx.agence_a1, statut="verifiee", necessite_action=True, date_resolution=NOW)
    for _ in range(2):
        _issue(db, ctx.org_a, ctx.agence_a1, statut="resolue", necessite_action=True, date_resolution=NOW)
    _issue(db, ctx.org_a, ctx.agence_a1, statut="action_en_cours", necessite_action=True)
    _issue(db, ctx.org_a, ctx.agence_a1, statut="ouverte", necessite_action=True)
    db.commit()
    r = calculer_loop_closure_rate(db, ctx.org_a)
    assert (r.numerator, r.denominator, r.value) == (6, 10, 60.0)
    assert (r.verified_count, r.requiring_action_count) == (6, 10)
    db.close()


def test_loop_closure_rate_aucune_issue_necessitant_action_no_data(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, statut="ouverte", necessite_action=False)
    db.commit()
    r = calculer_loop_closure_rate(db, ctx.org_a)
    assert r.status == "no_data"
    assert r.value is None
    db.close()


def test_loop_closure_rate_issue_non_verifiee_pas_au_numerateur(ctx):
    db = ctx.Session()
    _issue(db, ctx.org_a, ctx.agence_a1, statut="resolue", necessite_action=True, date_resolution=NOW)  # resolue, pas verifiee
    db.commit()
    r = calculer_loop_closure_rate(db, ctx.org_a)
    assert (r.numerator, r.denominator, r.value) == (0, 1, 0.0)
    db.close()

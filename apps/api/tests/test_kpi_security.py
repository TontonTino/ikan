"""
KPI Engine — isolation organisation/agence. Deux organisations avec leurs propres
feedbacks/Issues : aucun calcul pour l'organisation A ne doit jamais inclure les
données de B, avec ou sans filtre agence, y compris quand agence_id appartient à
l'AUTRE organisation (tentative de fuite par combinaison org/agence incohérente).
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-security-tests-0123456789")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.agence import Agence
from app.models.action_corrective import ActionCorrective
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.historique_issue import HistoriqueIssue
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
    calculer_issue_backlog,
    calculer_backlog_age,
    calculer_action_completion_rate,
    calculer_issue_recurrence_rate,
    calculer_negative_sentiment_rate,
    calculer_nps,
    calculer_sla_compliance_rate,
)

NOW = datetime.now(timezone.utc)


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__,
                Feedback.__table__, AnalyseIA.__table__, Issue.__table__, HistoriqueIssue.__table__, ActionCorrective.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_a = Organisation(id=uuid4(), nom="Org A", active=True)
    org_b = Organisation(id=uuid4(), nom="Org B", active=True)
    db.add_all([org_a, org_b])
    db.flush()

    agence_a = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A", active=True)
    agence_b = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B", active=True)
    db.add_all([agence_a, agence_b])
    db.flush()

    qr_a = QRCode(id=uuid4(), agence_id=agence_a.id, code="QR-A", url="http://t/a", actif=True)
    qr_b = QRCode(id=uuid4(), agence_id=agence_b.id, code="QR-B", url="http://t/b", actif=True)
    db.add_all([qr_a, qr_b])
    db.flush()

    # Org A : 4 feedbacks (2 positifs, 1 negatif analyse, 1 non analyse), 1 Issue critique resolue
    for note, sentiment in [(5, SentimentType.POSITIF), (5, SentimentType.POSITIF), (1, SentimentType.NEGATIF), (2, None)]:
        fb = Feedback(id=uuid4(), qr_code_id=qr_a.id, note=note, nps_note=10, commentaire="A", statut_traitement="nouveau", date_soumission=NOW)
        db.add(fb)
        db.flush()
        if sentiment:
            db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment, criticite=CriticiteType.FAIBLE, score_sentiment=0.5))
    db.add(Issue(id=uuid4(), organisation_id=org_a.id, agence_id=agence_a.id, titre="Issue A",
                 statut="resolue", severite=CriticiteType.CRITIQUE, necessite_action=True,
                 premiere_detection=NOW, date_resolution=NOW, date_limite_sla=NOW + timedelta(hours=1)))

    # Org B : 1 seul feedback tres negatif, 1 Issue verifiee necessitant action (donnees tres
    # differentes de A pour detecter facilement toute fuite dans les tests ci-dessous).
    fb_b = Feedback(id=uuid4(), qr_code_id=qr_b.id, note=1, nps_note=0, commentaire="B", statut_traitement="nouveau", date_soumission=NOW)
    db.add(fb_b)
    db.flush()
    db.add(AnalyseIA(id=uuid4(), feedback_id=fb_b.id, sentiment=SentimentType.NEGATIF, criticite=CriticiteType.CRITIQUE, score_sentiment=0.0))
    db.add(Issue(id=uuid4(), organisation_id=org_b.id, agence_id=agence_b.id, titre="Issue B",
                 statut="verifiee", severite=CriticiteType.CRITIQUE, necessite_action=True,
                 premiere_detection=NOW, date_resolution=NOW, date_limite_sla=NOW - timedelta(hours=1)))
    db.commit()

    ids = SimpleNamespace(org_a=org_a.id, org_b=org_b.id, agence_a=agence_a.id, agence_b=agence_b.id)
    db.close()
    return SimpleNamespace(Session=Session, **vars(ids))


def test_org_a_sans_filtre_agence_ne_voit_que_a(ctx):
    db = ctx.Session()
    assert calculer_feedback_volume(db, ctx.org_a).value == 4.0
    assert calculer_csat(db, ctx.org_a).numerator == 2
    # 3 feedbacks analyses cote A (2 positifs + 1 negatif) ; le 4e (sentiment=None) est exclu.
    assert calculer_negative_sentiment_rate(db, ctx.org_a).denominator == 3
    assert calculer_issue_volume(db, ctx.org_a).value == 1.0
    assert calculer_issue_backlog(db, ctx.org_a).value == 0.0
    assert calculer_backlog_age(db, ctx.org_a).status == "no_data"
    assert calculer_action_completion_rate(db, ctx.org_a).status == "no_data"
    assert calculer_nps(db, ctx.org_a).value == 100.0
    assert calculer_sla_compliance_rate(db, ctx.org_a).value == 100.0
    db.close()


def test_org_a_avec_sa_propre_agence(ctx):
    db = ctx.Session()
    assert calculer_feedback_volume(db, ctx.org_a, agence_id=ctx.agence_a).value == 4.0
    assert calculer_issue_volume(db, ctx.org_a, agence_id=ctx.agence_a).value == 1.0
    assert calculer_nps(db, ctx.org_a, agence_id=ctx.agence_a).value == 100.0
    assert calculer_sla_compliance_rate(db, ctx.org_a, agence_id=ctx.agence_a).value == 100.0
    assert calculer_sla_compliance_rate(db, ctx.org_a, agence_id=ctx.agence_b).status == "no_data"
    db.close()


def test_org_a_avec_agence_de_b_ne_recupere_rien_de_b(ctx):
    """Combinaison organisation_id=A + agence_id=B (incoherente) : ne doit JAMAIS renvoyer
    les donnees de B, ni celles de A (l'agence B n'appartient pas a A) -> vide/no_data."""
    db = ctx.Session()
    assert calculer_feedback_volume(db, ctx.org_a, agence_id=ctx.agence_b).value == 0.0
    assert calculer_csat(db, ctx.org_a, agence_id=ctx.agence_b).status == "no_data"
    assert calculer_issue_volume(db, ctx.org_a, agence_id=ctx.agence_b).value == 0.0
    assert calculer_critical_issue_rate(db, ctx.org_a, agence_id=ctx.agence_b).status == "no_data"
    assert calculer_loop_closure_rate(db, ctx.org_a, agence_id=ctx.agence_b).status == "no_data"
    assert calculer_nps(db, ctx.org_a, agence_id=ctx.agence_b).status == "no_data"
    db.close()


def test_org_b_sans_filtre_ne_voit_que_b(ctx):
    db = ctx.Session()
    assert calculer_feedback_volume(db, ctx.org_b).value == 1.0
    r_csat = calculer_csat(db, ctx.org_b)
    assert (r_csat.numerator, r_csat.denominator) == (0, 1)  # 1 seul feedback, note=1 -> pas positif
    r_sentiment = calculer_negative_sentiment_rate(db, ctx.org_b)
    assert (r_sentiment.numerator, r_sentiment.denominator) == (1, 1)
    assert calculer_issue_volume(db, ctx.org_b).value == 1.0
    assert calculer_nps(db, ctx.org_b).value == -100.0
    assert calculer_sla_compliance_rate(db, ctx.org_b).value == 0.0
    assert calculer_issue_backlog(db, ctx.org_b).value == 0.0
    r_loop = calculer_loop_closure_rate(db, ctx.org_b)
    assert (r_loop.numerator, r_loop.denominator, r_loop.value) == (1, 1, 100.0)
    db.close()


def test_org_b_avec_agence_de_a_ne_recupere_rien_de_a(ctx):
    db = ctx.Session()
    assert calculer_feedback_volume(db, ctx.org_b, agence_id=ctx.agence_a).value == 0.0
    assert calculer_issue_volume(db, ctx.org_b, agence_id=ctx.agence_a).value == 0.0
    db.close()


@pytest.fixture()
def ctx_recurrence():
    """Org A (agences A1 et A2) et Org B (agence B1), chacune avec une Issue racine résolue
    et une occurrence liée. Org A a aussi une Issue non récurrente en A1 et rien en A2.
    Attendus : A = 1/2 récurrentes (racine + occurrence), B = 1/3 (une Issue non récurrente
    en plus), et aucune fuite entre organisations ni entre agences."""
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, Issue.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_a = Organisation(id=uuid4(), nom="Org A", active=True)
    org_b = Organisation(id=uuid4(), nom="Org B", active=True)
    db.add_all([org_a, org_b])
    db.flush()

    agence_a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", active=True)
    agence_a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", active=True)
    agence_b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", active=True)
    db.add_all([agence_a1, agence_a2, agence_b1])
    db.flush()

    def issue(org, agence, titre, statut="resolue", origine=None):
        i = Issue(id=uuid4(), organisation_id=org.id, agence_id=agence.id, titre=titre,
                  statut=statut, severite=CriticiteType.CRITIQUE, necessite_action=True,
                  premiere_detection=NOW, date_resolution=NOW, date_limite_sla=NOW + timedelta(hours=1),
                  issue_origine_id=origine.id if origine else None)
        db.add(i)
        db.flush()
        return i

    racine_a = issue(org_a, agence_a1, "Racine A")
    issue(org_a, agence_a1, "Occurrence A", origine=racine_a)
    issue(org_a, agence_a1, "Issue A non récurrente", statut="ouverte")
    racine_b = issue(org_b, agence_b1, "Racine B")
    issue(org_b, agence_b1, "Occurrence B", origine=racine_b)
    issue(org_b, agence_b1, "Issue B non récurrente", statut="ouverte")
    db.commit()

    ids = SimpleNamespace(org_a=org_a.id, org_b=org_b.id, agence_a1=agence_a1.id, agence_a2=agence_a2.id,
                          agence_b1=agence_b1.id)
    db.close()
    return SimpleNamespace(Session=Session, **vars(ids))


def test_recurrence_jamais_visible_hors_organisation_ni_agence(ctx_recurrence):
    """Ni un utilisateur d'une autre organisation, ni un Agency Manager d'une autre agence ne
    doivent voir les Issues d'origine ni les occurrences de l'agence/organisation voisine."""
    db = ctx_recurrence.Session()
    # Organisation A : 3 Issues, dont 1 seule occurrence (la racine n'a pas d'origine).
    # Une fuite de B dans A donnerait (2, 6) : le test échouerait.
    r_a = calculer_issue_recurrence_rate(db, ctx_recurrence.org_a)
    assert (r_a.numerator, r_a.denominator) == (1, 3)
    # Utilisateur de l'organisation B : ne voit que ses propres Issues.
    r_b = calculer_issue_recurrence_rate(db, ctx_recurrence.org_b)
    assert (r_b.numerator, r_b.denominator) == (1, 3)
    # Agency Manager de A2 (aucune Issue) : rien de A1, aucune occurrence visible.
    assert calculer_issue_recurrence_rate(db, ctx_recurrence.org_a, agence_id=ctx_recurrence.agence_a2).status == "no_data"
    # Agency Manager de A1 : voit ses propres occurrences uniquement.
    r_a1 = calculer_issue_recurrence_rate(db, ctx_recurrence.org_a, agence_id=ctx_recurrence.agence_a1)
    assert (r_a1.numerator, r_a1.denominator) == (1, 3)
    # Combinaison incohérente org A + agence de B : rien, ni occurrence de B.
    assert calculer_issue_recurrence_rate(db, ctx_recurrence.org_a, agence_id=ctx_recurrence.agence_b1).status == "no_data"
    # Combinaison incohérente org B + agence de A2 : rien.
    assert calculer_issue_recurrence_rate(db, ctx_recurrence.org_b, agence_id=ctx_recurrence.agence_a2).status == "no_data"
    db.close()


def test_isolation_resolution_rate_et_criticite(ctx):
    """Verifie explicitement que les KPI Issue (jointure directe organisation_id/agence_id,
    pas de jointure Feedback->QRCode->Agence) ne fuient pas non plus."""
    db = ctx.Session()
    r_a = calculer_issue_resolution_rate(db, ctx.org_a)
    r_b = calculer_issue_resolution_rate(db, ctx.org_b)
    assert (r_a.numerator, r_a.denominator) == (1, 1)  # Issue A: resolue
    assert (r_b.numerator, r_b.denominator) == (1, 1)  # Issue B: verifiee (compte aussi comme resolue)

    crit_a = calculer_critical_issue_rate(db, ctx.org_a)
    crit_b = calculer_critical_issue_rate(db, ctx.org_b)
    assert (crit_a.numerator, crit_a.denominator) == (1, 1)
    assert (crit_b.numerator, crit_b.denominator) == (1, 1)
    db.close()

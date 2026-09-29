"""
KPI Engine — calculs des 8 KPI P0, une seule source de vérité, réutilisable par les
futurs endpoints statistiques, dashboard, alertes et exports (voir definitions.py pour
la stratégie de période et la convention "no_data").

Toutes les agrégations sont faites en SQL (func.count/func.sum(case(...))), sauf
MEDIAN_RESOLUTION_TIME qui projette seulement les deux colonnes de dates nécessaires
(pas les entités complètes) et calcule la médiane côté Python — percentile_cont() est
spécifique PostgreSQL et casserait la compatibilité des tests SQLite.

Cloisonnement : organisation_id est TOUJOURS obligatoire, agence_id est optionnel.
Aucune fonction ne peut être appelée sans contexte d'organisation.
"""
import statistics
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.qr_code import QRCode
from app.schemas.kpi import KPIResult
from app.services.kpi.definitions import KPI_DEFINITIONS

ISSUE_STATUTS_RESOLUS = ("resolue", "verifiee")


def _date_debut(jours: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=jours)


def _no_data(code: str, **extra) -> KPIResult:
    d = KPI_DEFINITIONS[code]
    return KPIResult(code=code, label=d.label, unit=d.unit, status="no_data", **extra)


def _base_feedback_query(db: Session, organisation_id: UUID, agence_id: Optional[UUID], jours: int):
    """Feedback -> QRCode -> Agence, scopé organisation (+ agence si fourni), période sur
    date_soumission — même jointure que dashboard.py."""
    q = (
        db.query(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .filter(Agence.organisation_id == organisation_id, Feedback.date_soumission >= _date_debut(jours))
    )
    if agence_id:
        q = q.filter(Agence.id == agence_id)
    return q


def _base_issue_query(db: Session, organisation_id: UUID, agence_id: Optional[UUID], jours: int):
    """Issue scopée directement (pas de jointure : organisation_id/agence_id sont sur
    l'Issue elle-même), période sur premiere_detection."""
    q = db.query(Issue).filter(Issue.organisation_id == organisation_id, Issue.premiere_detection >= _date_debut(jours))
    if agence_id:
        q = q.filter(Issue.agence_id == agence_id)
    return q


def calculer_csat(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    total, positifs = (
        _base_feedback_query(db, organisation_id, agence_id, jours)
        .with_entities(
            func.count(Feedback.id),
            func.sum(case((Feedback.note >= 4, 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    if total == 0:
        return _no_data("CSAT")
    positifs = positifs or 0
    d = KPI_DEFINITIONS["CSAT"]
    return KPIResult(
        code="CSAT", label=d.label, unit=d.unit, status="ok",
        value=round(positifs / total * 100, 1), numerator=positifs, denominator=total,
    )


def calculer_negative_sentiment_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    q = (
        db.query(
            func.count(AnalyseIA.id),
            func.sum(case((AnalyseIA.sentiment == SentimentType.NEGATIF, 1), else_=0)),
        )
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .filter(Agence.organisation_id == organisation_id, Feedback.date_soumission >= _date_debut(jours))
    )
    if agence_id:
        q = q.filter(Agence.id == agence_id)
    total_analyses, negatifs = q.one()
    total_analyses = total_analyses or 0
    if total_analyses == 0:
        return _no_data("NEGATIVE_SENTIMENT_RATE")
    negatifs = negatifs or 0
    d = KPI_DEFINITIONS["NEGATIVE_SENTIMENT_RATE"]
    return KPIResult(
        code="NEGATIVE_SENTIMENT_RATE", label=d.label, unit=d.unit, status="ok",
        value=round(negatifs / total_analyses * 100, 1), numerator=negatifs, denominator=total_analyses,
    )


def calculer_feedback_volume(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    total = _base_feedback_query(db, organisation_id, agence_id, jours).with_entities(func.count(Feedback.id)).scalar() or 0
    d = KPI_DEFINITIONS["FEEDBACK_VOLUME"]
    return KPIResult(code="FEEDBACK_VOLUME", label=d.label, unit=d.unit, status="ok", value=float(total))


def calculer_issue_volume(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    total = _base_issue_query(db, organisation_id, agence_id, jours).with_entities(func.count(Issue.id)).scalar() or 0
    d = KPI_DEFINITIONS["ISSUE_VOLUME"]
    return KPIResult(code="ISSUE_VOLUME", label=d.label, unit=d.unit, status="ok", value=float(total))


def calculer_critical_issue_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    total, critiques = (
        _base_issue_query(db, organisation_id, agence_id, jours)
        .with_entities(
            func.count(Issue.id),
            func.sum(case((Issue.severite == CriticiteType.CRITIQUE, 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    if total == 0:
        return _no_data("CRITICAL_ISSUE_RATE")
    critiques = critiques or 0
    d = KPI_DEFINITIONS["CRITICAL_ISSUE_RATE"]
    return KPIResult(
        code="CRITICAL_ISSUE_RATE", label=d.label, unit=d.unit, status="ok",
        value=round(critiques / total * 100, 1), numerator=critiques, denominator=total,
    )


def calculer_issue_resolution_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    total, resolues = (
        _base_issue_query(db, organisation_id, agence_id, jours)
        .with_entities(
            func.count(Issue.id),
            func.sum(case((Issue.statut.in_(ISSUE_STATUTS_RESOLUS), 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    if total == 0:
        return _no_data("ISSUE_RESOLUTION_RATE")
    resolues = resolues or 0
    d = KPI_DEFINITIONS["ISSUE_RESOLUTION_RATE"]
    return KPIResult(
        code="ISSUE_RESOLUTION_RATE", label=d.label, unit=d.unit, status="ok",
        value=round(resolues / total * 100, 1), numerator=resolues, denominator=total,
    )


def calculer_median_resolution_time(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    rows = (
        _base_issue_query(db, organisation_id, agence_id, jours)
        .filter(Issue.statut.in_(ISSUE_STATUTS_RESOLUS), Issue.date_resolution.isnot(None))
        .with_entities(Issue.premiere_detection, Issue.date_resolution)
        .all()
    )
    if not rows:
        return _no_data("MEDIAN_RESOLUTION_TIME")
    durees_heures = [(resolution - detection).total_seconds() / 3600 for detection, resolution in rows]
    d = KPI_DEFINITIONS["MEDIAN_RESOLUTION_TIME"]
    return KPIResult(
        code="MEDIAN_RESOLUTION_TIME", label=d.label, unit=d.unit, status="ok",
        value=round(statistics.median(durees_heures), 2), denominator=len(rows),
    )


def calculer_loop_closure_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    total, verifiees = (
        _base_issue_query(db, organisation_id, agence_id, jours)
        .filter(Issue.necessite_action == True)  # noqa: E712 - cohérent avec le style déjà utilisé (Agence.active == True)
        .with_entities(
            func.count(Issue.id),
            func.sum(case((Issue.statut == "verifiee", 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    if total == 0:
        return _no_data("LOOP_CLOSURE_RATE", requiring_action_count=0, verified_count=0)
    verifiees = verifiees or 0
    d = KPI_DEFINITIONS["LOOP_CLOSURE_RATE"]
    return KPIResult(
        code="LOOP_CLOSURE_RATE", label=d.label, unit=d.unit, status="ok",
        value=round(verifiees / total * 100, 1), numerator=verifiees, denominator=total,
        requiring_action_count=total, verified_count=verifiees,
    )


# Registre pour dispatch par code (utilisé par la future KPI API).
KPI_FUNCTIONS = {
    "CSAT": calculer_csat,
    "NEGATIVE_SENTIMENT_RATE": calculer_negative_sentiment_rate,
    "FEEDBACK_VOLUME": calculer_feedback_volume,
    "ISSUE_VOLUME": calculer_issue_volume,
    "CRITICAL_ISSUE_RATE": calculer_critical_issue_rate,
    "ISSUE_RESOLUTION_RATE": calculer_issue_resolution_rate,
    "MEDIAN_RESOLUTION_TIME": calculer_median_resolution_time,
    "LOOP_CLOSURE_RATE": calculer_loop_closure_rate,
}

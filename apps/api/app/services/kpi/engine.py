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

from sqlalchemy import and_, case, func, literal, or_, union_all
from sqlalchemy.orm import Session

from app.models.agence import Agence
from app.models.action_corrective import ActionCorrective
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.issue_escalation import IssueEscalation
from app.models.historique_issue import HistoriqueIssue
from app.models.categorie import Categorie
from app.models.qr_code import QRCode
from app.schemas.kpi import KPIResult
from app.services.kpi.definitions import KPI_DEFINITIONS
from app.services.kpi.packs_telecom import (
    CLE_PAR_KPI_RECLAMATIONS,
    PERIMETRE_AGENCE,
    PERIMETRE_CATEGORIES,
    PERIMETRE_HORS_AGENCE,
    TOUTES_LES_CLES_DU_PACK,
)

ISSUE_STATUTS_RESOLUS = ("resolue", "verifiee")
ISSUE_STATUTS_BACKLOG = ("ouverte", "action_en_cours", "reouverte")


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
def calculer_issue_backlog(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Stock courant d'Issues ouvertes. `jours` est ignoré pour cette mesure de stock."""
    q = db.query(Issue).filter(Issue.organisation_id == organisation_id, Issue.statut.in_(ISSUE_STATUTS_BACKLOG))
    if agence_id:
        q = q.filter(Issue.agence_id == agence_id)
    total = q.with_entities(func.count(Issue.id)).scalar() or 0
    d = KPI_DEFINITIONS["ISSUE_BACKLOG"]
    return KPIResult(code="ISSUE_BACKLOG", label=d.label, unit=d.unit, status="ok",
                     value=float(total), numerator=total, denominator=total)


def _as_utc(value: datetime) -> datetime:
    """SQLite may return naive datetimes for timezone-aware columns; interpret them as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def calculer_backlog_age(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Median age in hours of the current backlog cycle; `jours` does not limit the stock."""
    q = db.query(Issue).filter(Issue.organisation_id == organisation_id, Issue.statut.in_(ISSUE_STATUTS_BACKLOG))
    if agence_id:
        q = q.filter(Issue.agence_id == agence_id)
    issues = q.with_entities(Issue.id, Issue.premiere_detection).all()
    if not issues:
        return _no_data("BACKLOG_AGE")
    issue_ids = [issue_id for issue_id, _ in issues]
    reopened_events = (
        db.query(HistoriqueIssue.issue_id, func.max(HistoriqueIssue.date_evenement))
        .filter(HistoriqueIssue.issue_id.in_(issue_ids), HistoriqueIssue.nouveau_statut == "reouverte")
        .group_by(HistoriqueIssue.issue_id).all()
    )
    reopened_at = {issue_id: date for issue_id, date in reopened_events}
    now = datetime.now(timezone.utc)
    ages_hours = [(now - _as_utc(reopened_at.get(issue_id) or detected)).total_seconds() / 3600
                  for issue_id, detected in issues]
    d = KPI_DEFINITIONS["BACKLOG_AGE"]
    return KPIResult(code="BACKLOG_AGE", label=d.label, unit=d.unit, status="ok",
                     value=round(statistics.median(ages_hours), 2), denominator=len(ages_hours))


def calculer_action_completion_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    q = (db.query(ActionCorrective).join(Issue, ActionCorrective.issue_id == Issue.id)
         .filter(Issue.organisation_id == organisation_id,
                 ActionCorrective.created_at >= _date_debut(jours), ActionCorrective.statut != "annulee"))
    if agence_id:
        q = q.filter(Issue.agence_id == agence_id)
    total, terminees = q.with_entities(
        func.count(ActionCorrective.id), func.sum(case((ActionCorrective.statut == "terminee", 1), else_=0))
    ).one()
    total = total or 0
    if total == 0:
        return _no_data("ACTION_COMPLETION_RATE")
    terminees = terminees or 0
    d = KPI_DEFINITIONS["ACTION_COMPLETION_RATE"]
    return KPIResult(code="ACTION_COMPLETION_RATE", label=d.label, unit=d.unit, status="ok",
                     value=round(terminees / total * 100, 1), numerator=terminees, denominator=total)


def calculer_sla_compliance_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Share of SLA-bearing Issues resolved within their absolute deadline during the period."""
    maintenant = datetime.now(timezone.utc)
    date_debut = maintenant - timedelta(days=jours)
    q = db.query(Issue).filter(
        Issue.organisation_id == organisation_id,
        Issue.statut.in_(ISSUE_STATUTS_RESOLUS),
        Issue.date_resolution.isnot(None),
        Issue.date_limite_sla.isnot(None),
        Issue.date_resolution >= date_debut,
        Issue.date_resolution <= maintenant,
    )
    if agence_id:
        q = q.filter(Issue.agence_id == agence_id)
    total, conformes = q.with_entities(
        func.count(Issue.id),
        func.sum(case((Issue.date_resolution <= Issue.date_limite_sla, 1), else_=0)),
    ).one()
    total = total or 0
    if total == 0:
        return _no_data("SLA_COMPLIANCE_RATE")
    conformes = conformes or 0
    d = KPI_DEFINITIONS["SLA_COMPLIANCE_RATE"]
    return KPIResult(
        code="SLA_COMPLIANCE_RATE", label=d.label, unit=d.unit, status="ok",
        value=round(conformes / total * 100, 1), numerator=conformes, denominator=total,
    )


def calculer_issue_recurrence_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Share of Issues detected in the period explicitly linked to an earlier root Issue."""
    total, recurrentes = (
        _base_issue_query(db, organisation_id, agence_id, jours)
        .with_entities(
            func.count(Issue.id),
            func.sum(case((Issue.issue_origine_id.isnot(None), 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    recurrentes = recurrentes or 0
    if total == 0:
        return _no_data("ISSUE_RECURRENCE_RATE", numerator=0, denominator=0)
    d = KPI_DEFINITIONS["ISSUE_RECURRENCE_RATE"]
    return KPIResult(
        code="ISSUE_RECURRENCE_RATE", label=d.label, unit=d.unit, status="ok",
        value=round(recurrentes / total * 100, 1), numerator=recurrentes, denominator=total,
    )


# ── Pack telecom (app/services/kpi/packs_telecom.py) — famille sectorielle, voir packs.py ──
# Seuil "moins de 5 Issues -> no_data" (PERIMETRE_CATEGORIES.md / rapport de l'étape 0) :
# distinct de ISSUE_RECURRENCE_RATE ci-dessus (seuil 0), car ces KPIs sectoriels portent sur
# des sous-populations bien plus petites, où un ratio sur 1 ou 2 Issues serait trompeur.
SEUIL_MIN_ISSUES_TELECOM = 5


def calculer_tel_part_hors_perimetre(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Part des Issues classées (catégorie à clé du pack) dont la clé appartient au groupe
    hors_agence — ne mesure PAS la performance de l'agence, voir description dans
    definitions.py. Expose aussi le nombre d'Issues non classées (sans catégorie, ou
    catégorie sans clé du pack) sur la même période/périmètre."""
    total, classees, hors_agence = (
        _base_issue_query(db, organisation_id, agence_id, jours)
        .outerjoin(Categorie, Issue.categorie_id == Categorie.id)
        .with_entities(
            func.count(Issue.id),
            func.sum(case((Categorie.cle.in_(TOUTES_LES_CLES_DU_PACK), 1), else_=0)),
            func.sum(case((Categorie.cle.in_(PERIMETRE_CATEGORIES[PERIMETRE_HORS_AGENCE]), 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    classees = classees or 0
    hors_agence = hors_agence or 0
    non_classees = total - classees
    if classees < SEUIL_MIN_ISSUES_TELECOM:
        return _no_data("TEL_PART_HORS_PERIMETRE", numerator=hors_agence, denominator=classees, non_classees_count=non_classees)
    d = KPI_DEFINITIONS["TEL_PART_HORS_PERIMETRE"]
    return KPIResult(
        code="TEL_PART_HORS_PERIMETRE", label=d.label, unit=d.unit, status="ok",
        value=round(hors_agence / classees * 100, 1), numerator=hors_agence, denominator=classees,
        non_classees_count=non_classees,
    )


def _calculer_tel_recurrence(code: str, groupe: str, db: Session, organisation_id: UUID,
                              agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Même formule qu'ISSUE_RECURRENCE_RATE, restreinte aux Issues dont la catégorie a une
    clé du `groupe` donné (app/services/kpi/packs_telecom.py::PERIMETRE_CATEGORIES). Le
    groupe "mixte" est toujours exclu par construction : seuls les codes TEL_RECURRENCE_AGENCE
    (groupe="agence") et TEL_RECURRENCE_HORS_PERIMETRE (groupe="hors_agence") existent."""
    total, recurrentes = (
        _base_issue_query(db, organisation_id, agence_id, jours)
        .join(Categorie, Issue.categorie_id == Categorie.id)
        .filter(Categorie.cle.in_(PERIMETRE_CATEGORIES[groupe]))
        .with_entities(
            func.count(Issue.id),
            func.sum(case((Issue.issue_origine_id.isnot(None), 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    recurrentes = recurrentes or 0
    if total < SEUIL_MIN_ISSUES_TELECOM:
        return _no_data(code, numerator=recurrentes, denominator=total)
    d = KPI_DEFINITIONS[code]
    return KPIResult(
        code=code, label=d.label, unit=d.unit, status="ok",
        value=round(recurrentes / total * 100, 1), numerator=recurrentes, denominator=total,
    )


def calculer_tel_recurrence_agence(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    return _calculer_tel_recurrence("TEL_RECURRENCE_AGENCE", PERIMETRE_AGENCE, db, organisation_id, agence_id, jours)


def calculer_tel_recurrence_hors_perimetre(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    return _calculer_tel_recurrence("TEL_RECURRENCE_HORS_PERIMETRE", PERIMETRE_HORS_AGENCE, db, organisation_id, agence_id, jours)


# Réclamations basées sur les feedbacks : même seuil que les autres KPI TEL_*, appliqué ici
# au nombre total de feedbacks de la période (le dénominateur).
SEUIL_MIN_FEEDBACKS_TELECOM = 5


def _calculer_tel_reclamations(code: str, db: Session, organisation_id: UUID,
                               agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Feedbacks de la période dont la catégorie a la clé du `code`
    (packs_telecom.CLE_PAR_KPI_RECLAMATIONS — jamais le nom de la catégorie) ET dont le
    sentiment IA est NEGATIF (définition de NEGATIVE_SENTIMENT_RATE), divisés par TOUS les
    feedbacks de la période (même population que FEEDBACK_VOLUME, via _base_feedback_query).
    Outer joins : un feedback sans catégorie ou sans AnalyseIA reste au dénominateur et
    n'est jamais compté négatif. AnalyseIA.feedback_id est unique : aucun double compte."""
    cle = CLE_PAR_KPI_RECLAMATIONS[code]
    total, negatifs = (
        _base_feedback_query(db, organisation_id, agence_id, jours)
        .outerjoin(Categorie, Feedback.categorie_id == Categorie.id)
        .outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .with_entities(
            func.count(Feedback.id),
            func.sum(case((and_(Categorie.cle == cle, AnalyseIA.sentiment == SentimentType.NEGATIF), 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    negatifs = negatifs or 0
    if total < SEUIL_MIN_FEEDBACKS_TELECOM:
        return _no_data(code, numerator=negatifs, denominator=total)
    d = KPI_DEFINITIONS[code]
    return KPIResult(
        code=code, label=d.label, unit=d.unit, status="ok",
        value=round(negatifs / total * 100, 1), numerator=negatifs, denominator=total,
    )


def calculer_tel_reclamations_reseau(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    return _calculer_tel_reclamations("TEL_RECLAMATIONS_RESEAU", db, organisation_id, agence_id, jours)


def calculer_tel_reclamations_recharge_forfait(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    return _calculer_tel_reclamations("TEL_RECLAMATIONS_RECHARGE_FORFAIT", db, organisation_id, agence_id, jours)


def calculer_tel_reclamations_facturation(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    return _calculer_tel_reclamations("TEL_RECLAMATIONS_FACTURATION", db, organisation_id, agence_id, jours)


def calculer_escalation_rate(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Share of Issues present in backlog during the period with an explicit escalation.

    The denominator is reconstructed from the initial detection time plus audited Issue
    status transitions. An Issue is eligible when a backlog status interval overlaps the
    reporting window, including Issues detected before the window.
    """
    maintenant = datetime.now(timezone.utc)
    date_debut = maintenant - timedelta(days=jours)

    issue_scope = [Issue.organisation_id == organisation_id]
    if agence_id is not None:
        issue_scope.append(Issue.agence_id == agence_id)

    # Every Issue starts in "ouverte" at premiere_detection. Subsequent status changes
    # are recorded in HistoriqueIssue by the Issue workflow endpoints.
    initial_states = (
        db.query(
            Issue.id.label("issue_id"),
            Issue.premiere_detection.label("status_at"),
            literal("ouverte").label("status"),
            literal(0).label("sequence"),
        )
        .filter(*issue_scope, Issue.premiere_detection <= maintenant)
    )
    transitions = (
        db.query(
            Issue.id.label("issue_id"),
            HistoriqueIssue.date_evenement.label("status_at"),
            HistoriqueIssue.nouveau_statut.label("status"),
            literal(1).label("sequence"),
        )
        .join(HistoriqueIssue, HistoriqueIssue.issue_id == Issue.id)
        .filter(
            *issue_scope,
            HistoriqueIssue.ancien_statut.isnot(None),
            HistoriqueIssue.nouveau_statut.isnot(None),
            HistoriqueIssue.ancien_statut != HistoriqueIssue.nouveau_statut,
            HistoriqueIssue.date_evenement <= maintenant,
        )
    )
    state_events = union_all(initial_states, transitions).cte("issue_status_events")
    state_intervals = (
        db.query(
            state_events.c.issue_id,
            state_events.c.status,
            state_events.c.status_at,
            func.lead(state_events.c.status_at).over(
                partition_by=state_events.c.issue_id,
                order_by=(state_events.c.status_at, state_events.c.sequence),
            ).label("next_status_at"),
        )
        .cte("issue_status_intervals")
    )
    eligible = (
        db.query(state_intervals.c.issue_id)
        .filter(
            state_intervals.c.status.in_(ISSUE_STATUTS_BACKLOG),
            state_intervals.c.status_at <= maintenant,
            or_(state_intervals.c.next_status_at.is_(None), state_intervals.c.next_status_at > date_debut),
        )
        .distinct()
        .cte("eligible_issues")
    )

    row = (
        db.query(
            func.count(func.distinct(eligible.c.issue_id)),
            func.count(func.distinct(IssueEscalation.issue_id)),
        )
        .select_from(
            eligible.outerjoin(
                IssueEscalation,
                and_(
                    IssueEscalation.issue_id == eligible.c.issue_id,
                    IssueEscalation.date_evenement >= date_debut,
                    IssueEscalation.date_evenement <= maintenant,
                ),
            )
        )
        .one()
    )
    denominator, numerator = (value or 0 for value in row)
    if denominator == 0:
        return _no_data("ESCALATION_RATE", numerator=0, denominator=0)
    d = KPI_DEFINITIONS["ESCALATION_RATE"]
    return KPIResult(
        code="ESCALATION_RATE", label=d.label, unit=d.unit, status="ok",
        value=round(numerator / denominator * 100, 1),
        numerator=numerator, denominator=denominator,
    )


def calculer_nps(db: Session, organisation_id: UUID, agence_id: Optional[UUID] = None, jours: int = 30) -> KPIResult:
    """Net Promoter Score for valid NPS responses submitted during the rolling period."""
    total, promoteurs, detracteurs = (
        _base_feedback_query(db, organisation_id, agence_id, jours)
        .filter(Feedback.nps_note.isnot(None))
        .with_entities(
            func.count(Feedback.id),
            func.sum(case((Feedback.nps_note >= 9, 1), else_=0)),
            func.sum(case((Feedback.nps_note <= 6, 1), else_=0)),
        )
        .one()
    )
    total = total or 0
    if total == 0:
        return _no_data("NPS")
    promoteurs = promoteurs or 0
    detracteurs = detracteurs or 0
    solde_net = promoteurs - detracteurs
    d = KPI_DEFINITIONS["NPS"]
    return KPIResult(
        code="NPS", label=d.label, unit=d.unit, status="ok",
        value=round(solde_net / total * 100, 1), numerator=solde_net, denominator=total,
    )


KPI_FUNCTIONS = {
    "CSAT": calculer_csat,
    "NEGATIVE_SENTIMENT_RATE": calculer_negative_sentiment_rate,
    "FEEDBACK_VOLUME": calculer_feedback_volume,
    "ISSUE_VOLUME": calculer_issue_volume,
    "CRITICAL_ISSUE_RATE": calculer_critical_issue_rate,
    "ISSUE_RESOLUTION_RATE": calculer_issue_resolution_rate,
    "MEDIAN_RESOLUTION_TIME": calculer_median_resolution_time,
    "LOOP_CLOSURE_RATE": calculer_loop_closure_rate,
    "ISSUE_BACKLOG": calculer_issue_backlog,
    "BACKLOG_AGE": calculer_backlog_age,
    "ACTION_COMPLETION_RATE": calculer_action_completion_rate,
    "SLA_COMPLIANCE_RATE": calculer_sla_compliance_rate,
    "ISSUE_RECURRENCE_RATE": calculer_issue_recurrence_rate,
    "ESCALATION_RATE": calculer_escalation_rate,
    "NPS": calculer_nps,
    "TEL_PART_HORS_PERIMETRE": calculer_tel_part_hors_perimetre,
    "TEL_RECURRENCE_AGENCE": calculer_tel_recurrence_agence,
    "TEL_RECURRENCE_HORS_PERIMETRE": calculer_tel_recurrence_hors_perimetre,
    "TEL_RECLAMATIONS_RESEAU": calculer_tel_reclamations_reseau,
    "TEL_RECLAMATIONS_RECHARGE_FORFAIT": calculer_tel_reclamations_recharge_forfait,
    "TEL_RECLAMATIONS_FACTURATION": calculer_tel_reclamations_facturation,
}

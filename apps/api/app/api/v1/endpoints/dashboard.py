"""
Endpoints Dashboard — KPIs et indicateurs de satisfaction (BF-09).
"""
from uuid import UUID
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import (
    get_admin_user,
    get_current_active_user,
    get_cx_manager,
    get_cx_or_agency_manager,
    get_cx_or_admin,
    get_db,
)
from app.models.utilisateur import Utilisateur
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.agence import Agence
from app.models.organisation import Organisation
from app.models.demande_contact import DemandeContact
from app.models.analyse_ia import AnalyseIA
from app.models.suggestion import Suggestion
from app.models.enums import UserRole, SentimentType, IdeaStatus
from app.schemas.dashboard import (
    DashboardAgence,
    DashboardSiege,
    KPIAgence,
    TendanceSatisfaction,
    ThemeStats,
    SentimentStats,
    DashboardAdminStats,
    ActivityPoint,
    AdminOrganisationHierarchy,
    AdminUserItem,
    AdminAgenceItem,
    StatKPI,
    EvolutionPoint,
    ThemeStatsDetail,
    AgenceRankDetail,
    AgenceImpacteeItem,
    AlerteSyntheseDetail,
    InsightIADetail,
    OrganisationRankDetail,
    StatsCXResponse,
    StatsAgenceResponse,
    StatsAdminResponse,
)

router = APIRouter()


@router.get("/agence/{agence_id}", response_model=DashboardAgence)
def dashboard_agence(
    agence_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
    jours: int = Query(30, ge=1, le=365),
):
    """Dashboard complet pour un Agency Manager ou CX Manager."""
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    date_debut = datetime.now(timezone.utc) - timedelta(days=jours)

    # Feedbacks de la période
    feedbacks = (
        db.query(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id == agence_id,
            Feedback.date_soumission >= date_debut,
        )
        .all()
    )

    total = len(feedbacks)
    if total == 0:
        taux = 0.0
    else:
        positifs = sum(1 for f in feedbacks if f.note >= 4)
        taux = round(positifs / total * 100, 1)

    # Analyses IA
    analyses_ids = [f.id for f in feedbacks]
    analyses = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(analyses_ids)).all()

    negatifs = sum(1 for a in analyses if a.sentiment == SentimentType.NEGATIF)
    from app.models.enums import CriticiteType
    critiques = sum(1 for a in analyses if a.criticite == CriticiteType.CRITIQUE)
    discordances = sum(1 for a in analyses if a.discordance_detectee)

    # Suggestions
    fb_ids = [f.id for f in feedbacks]
    nb_suggestions = db.query(Suggestion).filter(Suggestion.feedback_id.in_(fb_ids)).count()

    # Thèmes
    themes_count: dict[str, int] = {}
    for a in analyses:
        if a.theme_principal:
            themes_count[a.theme_principal] = themes_count.get(a.theme_principal, 0) + 1
    nb_analyses = len(analyses) or 1
    themes = [
        ThemeStats(theme=k, count=v, pourcentage=round(v / nb_analyses * 100, 1))
        for k, v in sorted(themes_count.items(), key=lambda x: -x[1])
    ]

    # Tendances (par semaine)
    tendances = _compute_tendances(feedbacks, jours)

    return DashboardAgence(
        agence_id=agence_id,
        agence_nom=agence.nom if agence else str(agence_id),
        periode=f"{jours} derniers jours",
        taux_satisfaction=taux,
        nombre_feedbacks=total,
        nombre_negatifs=negatifs,
        nombre_critiques=critiques,
        nombre_suggestions=nb_suggestions,
        tendances=tendances,
        themes=themes,
        discordances=discordances,
    )


@router.get("/siege", response_model=DashboardSiege)
def dashboard_siege(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
    jours: int = Query(30, ge=1, le=365),
):
    """Dashboard vue siège pour CX Manager et Admin."""
    date_debut = datetime.now(timezone.utc) - timedelta(days=jours)

    query_agences = db.query(Agence).filter(Agence.active == True)
    if current_user.organisation_id:
        query_agences = query_agences.filter(Agence.organisation_id == current_user.organisation_id)

    agences = query_agences.all()

    kpis = []
    all_feedbacks = []

    for agence in agences:
        feedbacks = (
            db.query(Feedback)
            .join(QRCode, Feedback.qr_code_id == QRCode.id)
            .filter(
                QRCode.agence_id == agence.id,
                Feedback.date_soumission >= date_debut,
            )
            .all()
        )
        all_feedbacks.extend(feedbacks)
        total = len(feedbacks)
        taux = round(sum(1 for f in feedbacks if f.note >= 4) / total * 100, 1) if total else 0.0
        analyses_ids = [f.id for f in feedbacks]
        negatifs = db.query(AnalyseIA).filter(
            AnalyseIA.feedback_id.in_(analyses_ids),
            AnalyseIA.sentiment == SentimentType.NEGATIF,
        ).count()

        kpis.append(KPIAgence(
            agence_id=agence.id,
            agence_nom=agence.nom,
            ville=agence.ville,
            taux_satisfaction=taux,
            nombre_feedbacks=total,
            nombre_negatifs=negatifs,
            nombre_suggestions=db.query(Suggestion).filter(
                Suggestion.feedback_id.in_([f.id for f in feedbacks])
            ).count(),
            latitude=agence.latitude,
            longitude=agence.longitude,
        ))

    total_global = len(all_feedbacks)
    taux_global = (
        round(sum(1 for f in all_feedbacks if f.note >= 4) / total_global * 100, 1)
        if total_global else 0.0
    )

    from app.models.enums import IdeaStatus
    idees_attente = db.query(Suggestion).filter(
        Suggestion.statut == IdeaStatus.NOUVEAU
    ).count()

    tendances = _compute_tendances(all_feedbacks, jours)

    # Calcul des thèmes et sentiments globaux (toutes agences)
    all_fb_ids = [f.id for f in all_feedbacks]
    all_analyses = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(all_fb_ids)).all() if all_fb_ids else []

    # Thèmes globaux
    themes_count: dict[str, int] = {}
    for a in all_analyses:
        if a.theme_principal:
            themes_count[a.theme_principal] = themes_count.get(a.theme_principal, 0) + 1
    nb_analyses_total = len(all_analyses) or 1
    from app.schemas.dashboard import ThemeStats, SentimentStats
    themes_globaux = [
        ThemeStats(theme=k, count=v, pourcentage=round(v / nb_analyses_total * 100, 1))
        for k, v in sorted(themes_count.items(), key=lambda x: -x[1])
    ]

    # Sentiments globaux
    sentiments_count: dict[str, int] = {}
    for a in all_analyses:
        s = a.sentiment.value if hasattr(a.sentiment, 'value') else str(a.sentiment)
        sentiments_count[s] = sentiments_count.get(s, 0) + 1
    sentiments_globaux = [
        SentimentStats(sentiment=k, count=v, pourcentage=round(v / nb_analyses_total * 100, 1))
        for k, v in sorted(sentiments_count.items(), key=lambda x: -x[1])
    ]

    from app.models.enums import CriticiteType
    nombre_discordances = sum(1 for a in all_analyses if a.discordance_detectee)
    nombre_critiques = sum(1 for a in all_analyses if a.criticite == CriticiteType.CRITIQUE)

    return DashboardSiege(
        organisation_id=current_user.organisation_id,
        periode=f"{jours} derniers jours",
        feedbacks_total=total_global,
        taux_satisfaction_global=taux_global,
        idees_en_attente=idees_attente,
        agences_actives=len(agences),
        agences=sorted(kpis, key=lambda x: -x.taux_satisfaction),
        tendances=tendances,
        themes_globaux=themes_globaux,
        sentiments_globaux=sentiments_globaux,
        nombre_discordances=nombre_discordances,
        nombre_critiques=nombre_critiques,
    )


@router.get("/admin", response_model=DashboardAdminStats)
def dashboard_admin(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """
    Dashboard agrégé pour l'Administrateur Système.
    Retourne UNIQUEMENT des compteurs et pourcentages — aucune donnée individuelle.
    """
    from collections import defaultdict
    from app.models.enums import CriticiteType

    now = datetime.now(timezone.utc)

    # ── Bornes temporelles ──
    debut_mois_courant = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    debut_mois_precedent = (debut_mois_courant - timedelta(days=1)).replace(day=1)

    # ── Compteurs globaux (toutes périodes confondues) ──
    total_feedbacks = db.query(func.count(Feedback.id)).scalar() or 0
    processed_feedbacks = db.query(func.count(AnalyseIA.id)).scalar() or 0

    # ── Satisfaction globale ──
    if total_feedbacks > 0:
        positifs = db.query(func.count(Feedback.id)).filter(Feedback.note >= 4).scalar() or 0
        satisfaction_pct = round(positifs / total_feedbacks * 100, 1)
    else:
        satisfaction_pct = 0.0
    satisfaction_globale = f"{satisfaction_pct}%"

    # ── Organisations & utilisateurs ──
    total_organisations = db.query(func.count(Organisation.id)).filter(Organisation.active == True).scalar() or 0
    total_cx_managers = db.query(func.count(Utilisateur.id)).filter(Utilisateur.active == True).scalar() or 0

    # ── Alertes critiques (feedbacks avec criticité CRITIQUE) ──
    total_alertes = (
        db.query(func.count(AnalyseIA.id))
        .filter(AnalyseIA.criticite == CriticiteType.CRITIQUE)
        .scalar() or 0
    )

    # ── Fonction utilitaire : calcul de trend mois courant vs mois précédent ──
    def _compute_trend(current_count: int, previous_count: int) -> tuple[str | None, bool]:
        if previous_count == 0:
            if current_count > 0:
                return ("+100%", True)
            return (None, True)  # Pas de données historiques → "—"
        diff_pct = round((current_count - previous_count) / previous_count * 100, 1)
        sign = "+" if diff_pct >= 0 else ""
        return (f"{sign}{diff_pct}%", diff_pct >= 0)

    # ── Feedbacks du mois courant et précédent ──
    fb_mois_courant = (
        db.query(func.count(Feedback.id))
        .filter(Feedback.date_soumission >= debut_mois_courant)
        .scalar() or 0
    )
    fb_mois_precedent = (
        db.query(func.count(Feedback.id))
        .filter(
            Feedback.date_soumission >= debut_mois_precedent,
            Feedback.date_soumission < debut_mois_courant,
        )
        .scalar() or 0
    )
    feedbacks_trend, feedbacks_trend_positive = _compute_trend(fb_mois_courant, fb_mois_precedent)

    # ── Feedbacks traités du mois courant et précédent ──
    proc_mois_courant = (
        db.query(func.count(AnalyseIA.id))
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .filter(Feedback.date_soumission >= debut_mois_courant)
        .scalar() or 0
    )
    proc_mois_precedent = (
        db.query(func.count(AnalyseIA.id))
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .filter(
            Feedback.date_soumission >= debut_mois_precedent,
            Feedback.date_soumission < debut_mois_courant,
        )
        .scalar() or 0
    )
    processed_trend, processed_trend_positive = _compute_trend(proc_mois_courant, proc_mois_precedent)

    # ── Satisfaction trend ──
    def _satisfaction_for_period(start: datetime, end: datetime) -> float | None:
        total = (
            db.query(func.count(Feedback.id))
            .filter(Feedback.date_soumission >= start, Feedback.date_soumission < end)
            .scalar() or 0
        )
        if total == 0:
            return None
        pos = (
            db.query(func.count(Feedback.id))
            .filter(Feedback.date_soumission >= start, Feedback.date_soumission < end, Feedback.note >= 4)
            .scalar() or 0
        )
        return round(pos / total * 100, 1)

    sat_courant = _satisfaction_for_period(debut_mois_courant, now)
    sat_precedent = _satisfaction_for_period(debut_mois_precedent, debut_mois_courant)
    if sat_courant is not None and sat_precedent is not None and sat_precedent > 0:
        diff = round(sat_courant - sat_precedent, 1)
        sign = "+" if diff >= 0 else ""
        satisfaction_trend = f"{sign}{diff}%"
        satisfaction_trend_positive = diff >= 0
    else:
        satisfaction_trend = None
        satisfaction_trend_positive = True

    # ── Organisations trend ──
    orgs_trend, orgs_trend_positive = (None, True)  # Pas de date de création trackée de façon fiable

    # ── CX Managers trend ──
    cx_trend, cx_trend_positive = (None, True)

    # ── Alertes trend ──
    alertes_courant = (
        db.query(func.count(AnalyseIA.id))
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .filter(AnalyseIA.criticite == CriticiteType.CRITIQUE, Feedback.date_soumission >= debut_mois_courant)
        .scalar() or 0
    )
    alertes_precedent = (
        db.query(func.count(AnalyseIA.id))
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .filter(
            AnalyseIA.criticite == CriticiteType.CRITIQUE,
            Feedback.date_soumission >= debut_mois_precedent,
            Feedback.date_soumission < debut_mois_courant,
        )
        .scalar() or 0
    )
    alertes_trend, alertes_trend_positive = _compute_trend(alertes_courant, alertes_precedent)
    # Pour les alertes, une baisse est positive
    alertes_trend_positive = not alertes_trend_positive if alertes_trend is not None else False

    # ── Données d'activité pour les graphiques (compteurs agrégés uniquement) ──
    def _build_activity(days: int, group_label_fn, group_key_fn) -> list[ActivityPoint]:
        start = now - timedelta(days=days)
        # Feedbacks par groupe
        fb_rows = (
            db.query(
                func.date_trunc(group_key_fn, Feedback.date_soumission).label("bucket"),
                func.count(Feedback.id).label("cnt"),
            )
            .filter(Feedback.date_soumission >= start)
            .group_by("bucket")
            .order_by("bucket")
            .all()
        )
        points = []
        for row in fb_rows:
            label = group_label_fn(row.bucket) if row.bucket else "?"
            points.append(ActivityPoint(date=label, feedbacks=row.cnt, users=0))
        return points

    # Libellés français pour les jours de la semaine
    _JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]

    activity_7d = _build_activity(
        7,
        lambda dt: f"{_JOURS_FR[dt.weekday()]} {dt.day}",
        "day",
    )
    activity_30d = _build_activity(
        30,
        lambda dt: f"Sem {dt.isocalendar()[1]}",
        "week",
    )
    activity_90d = _build_activity(
        90,
        lambda dt: dt.strftime("%B")[:4].capitalize(),
        "month",
    )

    # ── Construction du détail des organisations pour le centre de supervision Admin ──
    orgs = db.query(Organisation).order_by(Organisation.nom.asc()).all()
    orgs_overview: list[AdminOrganisationHierarchy] = []

    for o in orgs:
        # Utilisateurs de l'organisation
        org_users = db.query(Utilisateur).filter(Utilisateur.organisation_id == o.id).all()
        cx_users = [u for u in org_users if u.role == UserRole.CX_MANAGER]
        agency_users = [u for u in org_users if u.role == UserRole.AGENCY_MANAGER]

        # Agences de l'organisation
        org_agences = db.query(Agence).filter(Agence.organisation_id == o.id).all()
        agences_map = {a.id: a for a in org_agences}

        # QR Codes et Feedbacks rattachés aux agences de l'organisation
        ag_ids = list(agences_map.keys())
        if ag_ids:
            qr_codes_list = db.query(QRCode).filter(QRCode.agence_id.in_(ag_ids)).all()
            qr_ids = [q.id for q in qr_codes_list]
            qr_map = {q.id: q.agence_id for q in qr_codes_list}
            org_fbs = db.query(Feedback).filter(Feedback.qr_code_id.in_(qr_ids)).all() if qr_ids else []
        else:
            qr_ids = []
            qr_map = {}
            org_fbs = []

        org_fb_ids = [f.id for f in org_fbs]
        org_analyses = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(org_fb_ids)).all() if org_fb_ids else []
        analyzed_fb_ids = set(a.feedback_id for a in org_analyses)

        # Map feedbacks par agence
        fb_by_agence: dict[UUID, list[Feedback]] = defaultdict(list)
        for f in org_fbs:
            ag_id = qr_map.get(f.qr_code_id)
            if ag_id:
                fb_by_agence[ag_id].append(f)

        total_org_recus = len(org_fbs)
        total_org_traites = len(org_analyses)
        if total_org_traites > total_org_recus:
            total_org_traites = total_org_recus
        taux_org_traitement = round((total_org_traites / total_org_recus * 100), 1) if total_org_recus > 0 else 0.0

        # Liste des CX Managers formatée
        cx_items: list[AdminUserItem] = []
        for cx in cx_users:
            cx_items.append(AdminUserItem(
                id=cx.id,
                nom=cx.nom,
                prenom=cx.prenom,
                email=cx.email,
                role="CX Manager",
                agence_nom=None,
                agences_count=len(org_agences),
                feedbacks_recus=total_org_recus,
                feedbacks_traites=total_org_traites,
                active=cx.active,
                derniere_connexion=cx.derniere_connexion.isoformat() if cx.derniere_connexion else None,
            ))

        # Liste des Agences formatée
        agence_items: list[AdminAgenceItem] = []
        for ag in org_agences:
            ag_fbs = fb_by_agence.get(ag.id, [])
            ag_recus = len(ag_fbs)
            ag_traites = sum(1 for f in ag_fbs if f.id in analyzed_fb_ids)
            ag_pos = sum(1 for f in ag_fbs if f.note >= 4)
            ag_sat = round((ag_pos / ag_recus * 100), 1) if ag_recus > 0 else 0.0
            agence_items.append(AdminAgenceItem(
                id=ag.id,
                nom=ag.nom,
                ville=ag.ville,
                adresse=ag.adresse,
                active=ag.active,
                seuil_alerte=ag.seuil_alerte,
                feedbacks_recus=ag_recus,
                feedbacks_traites=ag_traites,
                taux_satisfaction=ag_sat,
            ))

        # Liste des Agency Managers formatée
        agency_items: list[AdminUserItem] = []
        for am in agency_users:
            am_ag = agences_map.get(am.agence_id) if am.agence_id else None
            am_fbs = fb_by_agence.get(am.agence_id, []) if am.agence_id else []
            am_recus = len(am_fbs)
            am_traites = sum(1 for f in am_fbs if f.id in analyzed_fb_ids)
            agency_items.append(AdminUserItem(
                id=am.id,
                nom=am.nom,
                prenom=am.prenom,
                email=am.email,
                role="Agency Manager",
                agence_nom=am_ag.nom if am_ag else "—",
                agences_count=1 if am_ag else 0,
                feedbacks_recus=am_recus,
                feedbacks_traites=am_traites,
                active=am.active,
                derniere_connexion=am.derniere_connexion.isoformat() if am.derniere_connexion else None,
            ))

        all_user_items = cx_items + agency_items

        orgs_overview.append(AdminOrganisationHierarchy(
            id=o.id,
            nom=o.nom,
            logo=o.logo,
            secteur_activite=o.secteur_activite or o.secteur or "Général",
            pays_region=o.pays_region or "International",
            email_pro=o.email_pro or o.email or "",
            active=o.active,
            created_at=o.created_at.isoformat() if o.created_at else None,
            cx_managers_count=len(cx_users),
            agency_managers_count=len(agency_users),
            agences_count=len(org_agences),
            feedbacks_recus=total_org_recus,
            feedbacks_traites=total_org_traites,
            taux_traitement=taux_org_traitement,
            cx_managers=cx_items,
            agency_managers=agency_items,
            agences=agence_items,
            users=all_user_items,
        ))

    return DashboardAdminStats(
        total_feedbacks=total_feedbacks,
        processed_feedbacks=processed_feedbacks,
        feedbacks_trend=feedbacks_trend,
        feedbacks_trend_positive=feedbacks_trend_positive,
        processed_trend=processed_trend,
        processed_trend_positive=processed_trend_positive,
        satisfaction_globale=satisfaction_globale,
        satisfaction_trend=satisfaction_trend,
        satisfaction_trend_positive=satisfaction_trend_positive,
        total_organisations=total_organisations,
        organisations_trend=orgs_trend,
        organisations_trend_positive=orgs_trend_positive,
        total_cx_managers=total_cx_managers,
        cx_managers_trend=cx_trend,
        cx_managers_trend_positive=cx_trend_positive,
        total_alertes=total_alertes,
        alertes_trend=alertes_trend,
        alertes_trend_positive=alertes_trend_positive,
        activity_7d=activity_7d,
        activity_30d=activity_30d,
        activity_90d=activity_90d,
        organisations_overview=orgs_overview,
    )


def _compute_tendances(feedbacks: list, jours: int) -> list[TendanceSatisfaction]:
    """Calcule les tendances de satisfaction par semaine ou par jour."""
    from collections import defaultdict
    bucket: dict[str, list] = defaultdict(list)

    for f in feedbacks:
        if jours <= 30:
            key = f.date_soumission.strftime("%Y-%m-%d")
        else:
            # Regrouper par semaine
            key = f"Semaine {f.date_soumission.isocalendar()[1]}"
        bucket[key].append(f.note)

    return [
        TendanceSatisfaction(
            date=date,
            taux=round(sum(1 for n in notes if n >= 4) / len(notes) * 100, 1),
            nombre_feedbacks=len(notes),
        )
        for date, notes in sorted(bucket.items())
    ]


# ==============================================================================
# ENDPOINTS STATISTIQUES & ANALYSES (RBAC STRICT & AGRÉGATIONS POSTGRESQL)
# ==============================================================================

THEME_LABELS_MAP: dict[str, str] = {
    "attente": "Temps d'attente & Délais",
    "accueil": "Accueil & Amabilité",
    "disponibilite_accessibilite": "Disponibilité & Horaires",
    "tarifs": "Tarification & Transparence",
    "qualite_produit": "Qualité de service & Produits",
    "proprete_cadre": "Cadre & Propreté des locaux",
    "application_mobile": "Services Digitaux & App",
    "reseau": "Réseau & Couverture",
    "facturation": "Facturation & Prélèvements",
    "communication_information": "Information & Clarté",
    "livraison_logistique": "Livraison & Logistique",
    "resolution_probleme": "Prise en charge & SAV",
    "securite_confidentialite": "Sécurité & Confidentialité",
    "disponibilite_produit": "Disponibilité stocks & offres",
    "personnalisation_besoin": "Écoute & Conseils sur-mesure",
    "autre": "Autres motifs",
}


def _period_label(jours: int) -> str:
    if jours == 1:
        return "Aujourd'hui"
    if jours == 7:
        return "7 derniers jours"
    if jours == 14:
        return "14 derniers jours"
    if jours == 30:
        return "30 derniers jours"
    if jours == 90:
        return "90 derniers jours"
    if jours >= 365:
        return "Cette année"
    return f"{jours} derniers jours"


def _calc_kpi_trend(curr: float, prev: float, is_pct_diff: bool = False, invert_positive: bool = False) -> tuple[str | None, bool]:
    """
    Calcule la variation et son sens.
    Pour satisfaction / taux: is_pct_diff=True (différence de points de pourcentage).
    Pour volumes / alertes: is_pct_diff=False (taux d'évolution en %).
    invert_positive=True pour les alertes et retours négatifs (une baisse est positive).
    """
    if prev == 0:
        if curr > 0:
            val_str = "+100%"
            pos = not invert_positive
            return (val_str, pos)
        return (None, True)

    if is_pct_diff:
        diff = round(curr - prev, 1)
        sign = "+" if diff >= 0 else ""
        pos = (diff >= 0) if not invert_positive else (diff <= 0)
        return (f"{sign}{diff}%", pos)
    else:
        diff_pct = round((curr - prev) / prev * 100, 1)
        sign = "+" if diff_pct >= 0 else ""
        pos = (diff_pct >= 0) if not invert_positive else (diff_pct <= 0)
        return (f"{sign}{diff_pct}%", pos)


@router.get("/statistics/cx", response_model=StatsCXResponse)
def get_statistics_cx(
    jours: int = Query(30, ge=1, le=365),
    agence_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """
    Interface Statistiques & Analyses pour le CX Manager (Vue Réseau / Organisation).
    Données 100% dynamiques et agrégées issues de PostgreSQL.
    """
    from collections import defaultdict
    from app.models.enums import CriticiteType

    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=jours)
    previous_start = current_start - timedelta(days=jours)
    previous_end = current_start

    # Récupération de l'organisation
    org = None
    if current_user.organisation_id:
        org = db.query(Organisation).filter(Organisation.id == current_user.organisation_id).first()

    # Périmètre des agences autorisées
    query_agences = db.query(Agence).filter(Agence.active == True)
    if current_user.organisation_id:
        query_agences = query_agences.filter(Agence.organisation_id == current_user.organisation_id)

    org_agences = query_agences.all()
    agences_map = {a.id: a for a in org_agences}
    all_ag_ids = list(agences_map.keys())

    selected_agence_nom = None
    if agence_id:
        if agence_id in agences_map:
            ag_filter_ids = [agence_id]
            selected_agence_nom = agences_map[agence_id].nom
        else:
            ag_filter_ids = []
    else:
        ag_filter_ids = all_ag_ids

    # 1. QR Codes rattachés
    qr_codes = db.query(QRCode).filter(QRCode.agence_id.in_(ag_filter_ids)).all() if ag_filter_ids else []
    qr_ids = [q.id for q in qr_codes]
    qr_to_agence = {q.id: q.agence_id for q in qr_codes}

    # 2. Feedbacks Période Courante vs Période Précédente
    fbs_current = (
        db.query(Feedback)
        .filter(Feedback.qr_code_id.in_(qr_ids), Feedback.date_soumission >= current_start, Feedback.date_soumission <= now)
        .all()
        if qr_ids
        else []
    )
    fbs_prev = (
        db.query(Feedback)
        .filter(Feedback.qr_code_id.in_(qr_ids), Feedback.date_soumission >= previous_start, Feedback.date_soumission < previous_end)
        .all()
        if qr_ids
        else []
    )

    # Analyses IA correspondantes
    cur_fb_ids = [f.id for f in fbs_current]
    prev_fb_ids = [f.id for f in fbs_prev]

    analyses_current = (
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(cur_fb_ids)).all()
        if cur_fb_ids
        else []
    )
    analyses_prev = (
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(prev_fb_ids)).all()
        if prev_fb_ids
        else []
    )
    analyses_cur_map = {a.feedback_id: a for a in analyses_current}

    # 3. Calculs des KPIs
    total_curr = len(fbs_current)
    total_prev = len(fbs_prev)

    pos_curr = sum(1 for f in fbs_current if f.note >= 4)
    pos_prev = sum(1 for f in fbs_prev if f.note >= 4)

    neg_curr = sum(1 for f in fbs_current if f.note <= 2)
    neg_prev = sum(1 for f in fbs_prev if f.note <= 2)

    sat_curr = round(pos_curr / total_curr * 100, 1) if total_curr > 0 else 0.0
    sat_prev = round(pos_prev / total_prev * 100, 1) if total_prev > 0 else 0.0

    # Feedbacks traités (statut de traitement Closed-Loop ou présence AnalyseIA)
    def _is_treated(f: Feedback) -> bool:
        statut = getattr(f, "statut_traitement", "nouveau")
        if statut in ("en_cours", "en_traitement", "recontacte", "resolu", "escalade", "ferme"):
            return True
        return f.id in analyses_cur_map

    traites_curr = sum(1 for f in fbs_current if _is_treated(f))
    traites_prev = len(analyses_prev)
    attente_curr = max(0, total_curr - traites_curr)

    taux_trait_curr = round(traites_curr / total_curr * 100, 1) if total_curr > 0 else 0.0
    taux_trait_prev = round(traites_prev / total_prev * 100, 1) if total_prev > 0 else 0.0

    critiques_curr = sum(1 for a in analyses_current if a.criticite == CriticiteType.CRITIQUE)
    critiques_prev = sum(1 for a in analyses_prev if a.criticite == CriticiteType.CRITIQUE)

    # Construction du dictionnaire de KPIs avec vraies évolutions
    sat_ev, sat_pos = _calc_kpi_trend(sat_curr, sat_prev, is_pct_diff=True)
    tot_ev, tot_pos = _calc_kpi_trend(total_curr, total_prev)
    trt_ev, trt_pos = _calc_kpi_trend(traites_curr, traites_prev)
    tx_ev, tx_pos = _calc_kpi_trend(taux_trait_curr, taux_trait_prev, is_pct_diff=True)
    pos_ev, pos_p_pos = _calc_kpi_trend(pos_curr, pos_prev)
    neg_ev, neg_p_pos = _calc_kpi_trend(neg_curr, neg_prev, invert_positive=True)
    crit_ev, crit_p_pos = _calc_kpi_trend(critiques_curr, critiques_prev, invert_positive=True)

    kpis = {
        "satisfaction": StatKPI(
            valeur=f"{sat_curr}%",
            valeur_num=sat_curr,
            valeur_precedente=sat_prev,
            evolution=sat_ev,
            is_positive=sat_pos,
            sous_titre="Taux de clients satisfaits (notes 4-5/5)",
        ),
        "total_feedbacks": StatKPI(
            valeur=total_curr,
            valeur_num=float(total_curr),
            valeur_precedente=total_prev,
            evolution=tot_ev,
            is_positive=tot_pos,
            sous_titre="Avis collectés en borne et comptoir",
        ),
        "feedbacks_traites": StatKPI(
            valeur=traites_curr,
            valeur_num=float(traites_curr),
            valeur_precedente=traites_prev,
            evolution=trt_ev,
            is_positive=trt_pos,
            sous_titre=f"{taux_trait_curr}% du volume total pris en charge",
        ),
        "feedbacks_attente": StatKPI(
            valeur=attente_curr,
            valeur_num=float(attente_curr),
            valeur_precedente=max(0, total_prev - traites_prev),
            evolution=None,
            is_positive=attente_curr == 0,
            sous_titre="Nouveaux avis nécessitant une attention",
        ),
        "taux_traitement": StatKPI(
            valeur=f"{taux_trait_curr}%",
            valeur_num=taux_trait_curr,
            valeur_precedente=taux_trait_prev,
            evolution=tx_ev,
            is_positive=tx_pos,
            sous_titre="Efficacité opérationnelle de prise en charge",
        ),
        "feedbacks_positifs": StatKPI(
            valeur=pos_curr,
            valeur_num=float(pos_curr),
            valeur_precedente=pos_prev,
            evolution=pos_ev,
            is_positive=pos_p_pos,
            sous_titre="Retours enthousiastes & promoteurs",
        ),
        "feedbacks_negatifs": StatKPI(
            valeur=neg_curr,
            valeur_num=float(neg_curr),
            valeur_precedente=neg_prev,
            evolution=neg_ev,
            is_positive=neg_p_pos,
            sous_titre="Insatisfactions nécessitant un suivi",
        ),
        "alertes_critiques": StatKPI(
            valeur=critiques_curr,
            valeur_num=float(critiques_curr),
            valeur_precedente=critiques_prev,
            evolution=crit_ev,
            is_positive=crit_p_pos,
            sous_titre="Feedbacks à haute criticité détectés par l'IA",
        ),
    }

    # 4. Évolution temporelle (Satisfaction & Volume)
    _JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    timeline_map: dict[str, dict] = defaultdict(lambda: {
        "feedbacks": 0,
        "traites": 0,
        "notes": [],
        "positifs": 0,
        "neutres": 0,
        "negatifs": 0,
        "label": "",
    })

    for f in fbs_current:
        dt = f.date_soumission
        if jours <= 1:
            key = dt.strftime("%Hh")
            label = key
        elif jours <= 14:
            key = dt.strftime("%Y-%m-%d")
            label = f"{_JOURS_FR[dt.weekday()]} {dt.day}"
        elif jours <= 60:
            key = dt.strftime("%Y-%m-%d")
            label = dt.strftime("%d/%m")
        else:
            key = f"S{dt.isocalendar()[1]}-{dt.year}"
            label = f"Sem {dt.isocalendar()[1]}"

        timeline_map[key]["feedbacks"] += 1
        timeline_map[key]["notes"].append(f.note)
        timeline_map[key]["label"] = label
        if _is_treated(f):
            timeline_map[key]["traites"] += 1

        if f.note >= 4:
            timeline_map[key]["positifs"] += 1
        elif f.note == 3:
            timeline_map[key]["neutres"] += 1
        else:
            timeline_map[key]["negatifs"] += 1

    evolution_satisfaction: list[EvolutionPoint] = []
    evolution_volume: list[EvolutionPoint] = []

    for k, data in sorted(timeline_map.items()):
        cnt = data["feedbacks"]
        notes = data["notes"]
        sat_pct = round(sum(1 for n in notes if n >= 4) / len(notes) * 100, 1) if notes else 0.0
        pt = EvolutionPoint(
            date=k,
            label=data["label"],
            feedbacks=cnt,
            traites=data["traites"],
            satisfaction=sat_pct,
            positifs=data["positifs"],
            neutres=data["neutres"],
            negatifs=data["negatifs"],
        )
        evolution_satisfaction.append(pt)
        evolution_volume.append(pt)

    # 5. Répartition des sentiments
    sent_counts: dict[str, int] = {"positif": 0, "neutre": 0, "negatif": 0}
    for a in analyses_current:
        s = a.sentiment.value if hasattr(a.sentiment, "value") else str(a.sentiment).lower()
        if s in sent_counts:
            sent_counts[s] += 1
        else:
            sent_counts["neutre"] += 1

    # Si pas d'analyse IA mais feedbacks présents, fallback sur les notes
    if not analyses_current and fbs_current:
        for f in fbs_current:
            if f.note >= 4:
                sent_counts["positif"] += 1
            elif f.note == 3:
                sent_counts["neutre"] += 1
            else:
                sent_counts["negatif"] += 1

    total_sent = sum(sent_counts.values()) or 1
    sentiments_res = [
        SentimentStats(
            sentiment=k,
            count=v,
            pourcentage=round(v / total_sent * 100, 1),
        )
        for k, v in sent_counts.items()
    ]

    # 6. Principaux Thèmes IA
    theme_agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "sentiments": defaultdict(int)})
    for a in analyses_current:
        if a.theme_principal:
            th = a.theme_principal.lower().strip()
            theme_agg[th]["count"] += 1
            st = a.sentiment.value if hasattr(a.sentiment, "value") else str(a.sentiment)
            theme_agg[th]["sentiments"][st] += 1

    themes_res: list[ThemeStatsDetail] = []
    total_th_count = sum(t["count"] for t in theme_agg.values()) or 1
    for th_key, t_data in sorted(theme_agg.items(), key=lambda x: -x[1]["count"]):
        dominant_sent = max(t_data["sentiments"].items(), key=lambda x: x[1])[0] if t_data["sentiments"] else "neutre"
        themes_res.append(ThemeStatsDetail(
            theme=th_key,
            label=THEME_LABELS_MAP.get(th_key, th_key.replace("_", " ").capitalize()),
            count=t_data["count"],
            pourcentage=round(t_data["count"] / total_th_count * 100, 1),
            sentiment_predominant=dominant_sent,
        ))

    # 7. Classement des Agences (Ranking)
    # Grouper feedbacks par agence
    ag_fb_map: dict[UUID, list[Feedback]] = defaultdict(list)
    ag_prev_fb_map: dict[UUID, list[Feedback]] = defaultdict(list)
    for f in fbs_current:
        ag_id = qr_to_agence.get(f.qr_code_id)
        if ag_id:
            ag_fb_map[ag_id].append(f)

    for f in fbs_prev:
        ag_id = qr_to_agence.get(f.qr_code_id)
        if ag_id:
            ag_prev_fb_map[ag_id].append(f)

    agences_ranking: list[AgenceRankDetail] = []
    impacted_agencies: list[AgenceImpacteeItem] = []

    for ag_id in all_ag_ids:
        ag = agences_map.get(ag_id)
        if not ag:
            continue
        cur_list = ag_fb_map.get(ag_id, [])
        prev_list = ag_prev_fb_map.get(ag_id, [])

        ag_tot = len(cur_list)
        ag_prev_tot = len(prev_list)
        ag_pos = sum(1 for f in cur_list if f.note >= 4)
        ag_prev_pos = sum(1 for f in prev_list if f.note >= 4)

        ag_sat = round(ag_pos / ag_tot * 100, 1) if ag_tot > 0 else 0.0
        ag_prev_sat = round(ag_prev_pos / ag_prev_tot * 100, 1) if ag_prev_tot > 0 else 0.0

        ag_traites = sum(1 for f in cur_list if _is_treated(f))
        ag_taux_tr = round(ag_traites / ag_tot * 100, 1) if ag_tot > 0 else 0.0

        ag_critiques = sum(1 for f in cur_list if f.id in analyses_cur_map and analyses_cur_map[f.id].criticite == CriticiteType.CRITIQUE)

        ag_tend_str, ag_tend_pos = _calc_kpi_trend(ag_sat, ag_prev_sat, is_pct_diff=True)

        if ag_critiques > 0:
            impacted_agencies.append(AgenceImpacteeItem(
                agence_id=ag.id,
                agence_nom=ag.nom,
                ville=ag.ville,
                alertes_count=ag_critiques,
                satisfaction_rate=ag_sat,
            ))

        agences_ranking.append(AgenceRankDetail(
            agence_id=ag.id,
            agence_nom=ag.nom,
            ville=ag.ville,
            satisfaction_rate=ag_sat,
            total_feedbacks=ag_tot,
            feedbacks_traites=ag_traites,
            taux_traitement=ag_taux_tr,
            alertes_critiques=ag_critiques,
            tendance_val=ag_tend_str,
            tendance_positive=ag_tend_pos,
        ))

    agences_ranking.sort(key=lambda x: -x.satisfaction_rate)
    impacted_agencies.sort(key=lambda x: -x.alertes_count)

    alertes_synthese = AlerteSyntheseDetail(
        total_critiques=critiques_curr,
        agences_impactees=impacted_agencies,
        evolution_pct=crit_ev,
        evolution_positive=crit_p_pos,
    )

    # 8. Synthèse & Insights IA automatiques
    insights_ia: list[InsightIADetail] = []
    if sat_curr >= 80:
        insights_ia.append(InsightIADetail(
            id="insight-sat-positive",
            type="point_fort",
            titre="Excellente satisfaction globale",
            description=f"Le réseau maintient un score élevé de {sat_curr}% sur {total_curr} feedbacks analysés.",
            priorite="low",
            date=now.strftime("%d/%m/%Y"),
        ))
    elif sat_curr > 0:
        insights_ia.append(InsightIADetail(
            id="insight-sat-warning",
            type="point_vigilance",
            titre="Satisfaction à consolider",
            description=f"Le score actuel de {sat_curr}% nécessite des ajustements sur les points de friction remontés.",
            priorite="high",
            date=now.strftime("%d/%m/%Y"),
        ))

    if themes_res:
        top_theme = themes_res[0]
        insights_ia.append(InsightIADetail(
            id="insight-theme-top",
            type="recommandation",
            titre=f"Thématique majeure : {top_theme.label}",
            description=f"{top_theme.pourcentage}% des retours portent sur ce sujet ({top_theme.count} mentions). Une optimisation ciblée permettra de maximiser le NPS.",
            priorite="medium",
            date=now.strftime("%d/%m/%Y"),
        ))

    if critiques_curr > 0:
        top_impacted = impacted_agencies[0].agence_nom if impacted_agencies else "le réseau"
        insights_ia.append(InsightIADetail(
            id="insight-alertes",
            type="point_vigilance",
            titre="Alertes critiques actives",
            description=f"{critiques_curr} incident(s) critique(s) identifié(s), principalement sur {top_impacted}. Prise en charge prioritaire recommandée.",
            priorite="critical",
            agence_nom=top_impacted,
            date=now.strftime("%d/%m/%Y"),
        ))

    return StatsCXResponse(
        organisation_id=org.id if org else None,
        organisation_nom=org.nom if org else "IKAN Network",
        periode_jours=jours,
        periode_label=_period_label(jours),
        agence_filtree_id=agence_id,
        agence_filtree_nom=selected_agence_nom,
        kpis=kpis,
        evolution_satisfaction=evolution_satisfaction,
        evolution_volume=evolution_volume,
        sentiments=sentiments_res,
        themes=themes_res,
        agences_ranking=agences_ranking,
        alertes_synthese=alertes_synthese,
        insights_ia=insights_ia,
    )


@router.get("/statistics/agency", response_model=StatsAgenceResponse)
def get_statistics_agency(
    jours: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Interface Statistiques & Analyses pour un Agency Manager.
    Portée locale STRICTEMENT limitée à son agence attitrée.
    """
    from collections import defaultdict
    from app.models.enums import CriticiteType

    if not current_user.agence_id:
        raise HTTPException(status_code=400, detail="Aucune agence assignée à cet utilisateur.")

    agence = db.query(Agence).filter(Agence.id == current_user.agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=jours)
    previous_start = current_start - timedelta(days=jours)
    previous_end = current_start

    # QR Codes de l'agence
    qr_codes = db.query(QRCode).filter(QRCode.agence_id == agence.id).all()
    qr_ids = [q.id for q in qr_codes]

    # Feedbacks
    fbs_current = (
        db.query(Feedback)
        .filter(Feedback.qr_code_id.in_(qr_ids), Feedback.date_soumission >= current_start, Feedback.date_soumission <= now)
        .all()
        if qr_ids
        else []
    )
    fbs_prev = (
        db.query(Feedback)
        .filter(Feedback.qr_code_id.in_(qr_ids), Feedback.date_soumission >= previous_start, Feedback.date_soumission < previous_end)
        .all()
        if qr_ids
        else []
    )

    cur_fb_ids = [f.id for f in fbs_current]
    prev_fb_ids = [f.id for f in fbs_prev]

    analyses_current = (
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(cur_fb_ids)).all()
        if cur_fb_ids
        else []
    )
    analyses_prev = (
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(prev_fb_ids)).all()
        if prev_fb_ids
        else []
    )
    analyses_cur_map = {a.feedback_id: a for a in analyses_current}

    total_curr = len(fbs_current)
    total_prev = len(fbs_prev)

    pos_curr = sum(1 for f in fbs_current if f.note >= 4)
    pos_prev = sum(1 for f in fbs_prev if f.note >= 4)

    sat_curr = round(pos_curr / total_curr * 100, 1) if total_curr > 0 else 0.0
    sat_prev = round(pos_prev / total_prev * 100, 1) if total_prev > 0 else 0.0

    def _is_treated(f: Feedback) -> bool:
        statut = getattr(f, "statut_traitement", "nouveau")
        if statut in ("en_cours", "en_traitement", "recontacte", "resolu", "escalade", "ferme"):
            return True
        return f.id in analyses_cur_map

    traites_curr = sum(1 for f in fbs_current if _is_treated(f))
    traites_prev = len(analyses_prev)
    attente_curr = max(0, total_curr - traites_curr)

    taux_trait_curr = round(traites_curr / total_curr * 100, 1) if total_curr > 0 else 0.0
    taux_trait_prev = round(traites_prev / total_prev * 100, 1) if total_prev > 0 else 0.0

    critiques_curr = sum(1 for a in analyses_current if a.criticite == CriticiteType.CRITIQUE)
    critiques_prev = sum(1 for a in analyses_prev if a.criticite == CriticiteType.CRITIQUE)

    sat_ev, sat_pos = _calc_kpi_trend(sat_curr, sat_prev, is_pct_diff=True)
    tot_ev, tot_pos = _calc_kpi_trend(total_curr, total_prev)
    trt_ev, trt_pos = _calc_kpi_trend(traites_curr, traites_prev)
    tx_ev, tx_pos = _calc_kpi_trend(taux_trait_curr, taux_trait_prev, is_pct_diff=True)
    crit_ev, crit_p_pos = _calc_kpi_trend(critiques_curr, critiques_prev, invert_positive=True)

    kpis = {
        "satisfaction": StatKPI(
            valeur=f"{sat_curr}%",
            valeur_num=sat_curr,
            valeur_precedente=sat_prev,
            evolution=sat_ev,
            is_positive=sat_pos,
            sous_titre="Taux de satisfaction locale",
        ),
        "total_feedbacks": StatKPI(
            valeur=total_curr,
            valeur_num=float(total_curr),
            valeur_precedente=total_prev,
            evolution=tot_ev,
            is_positive=tot_pos,
            sous_titre="Avis déposés dans votre agence",
        ),
        "feedbacks_traites": StatKPI(
            valeur=traites_curr,
            valeur_num=float(traites_curr),
            valeur_precedente=traites_prev,
            evolution=trt_ev,
            is_positive=trt_pos,
            sous_titre=f"{taux_trait_curr}% des avis pris en charge",
        ),
        "feedbacks_attente": StatKPI(
            valeur=attente_curr,
            valeur_num=float(attente_curr),
            valeur_precedente=max(0, total_prev - traites_prev),
            evolution=None,
            is_positive=attente_curr == 0,
            sous_titre="Avis en attente de réponse locale",
        ),
        "taux_traitement": StatKPI(
            valeur=f"{taux_trait_curr}%",
            valeur_num=taux_trait_curr,
            valeur_precedente=taux_trait_prev,
            evolution=tx_ev,
            is_positive=tx_pos,
            sous_titre="Rapidité et taux de résolution locale",
        ),
        "alertes_critiques": StatKPI(
            valeur=critiques_curr,
            valeur_num=float(critiques_curr),
            valeur_precedente=critiques_prev,
            evolution=crit_ev,
            is_positive=crit_p_pos,
            sous_titre="Avis nécessitant un recontact d'urgence",
        ),
    }

    # Timeline
    _JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    timeline_map: dict[str, dict] = defaultdict(lambda: {
        "feedbacks": 0,
        "traites": 0,
        "notes": [],
        "positifs": 0,
        "neutres": 0,
        "negatifs": 0,
        "label": "",
    })

    for f in fbs_current:
        dt = f.date_soumission
        if jours <= 1:
            key = dt.strftime("%Hh")
            label = key
        elif jours <= 14:
            key = dt.strftime("%Y-%m-%d")
            label = f"{_JOURS_FR[dt.weekday()]} {dt.day}"
        elif jours <= 60:
            key = dt.strftime("%Y-%m-%d")
            label = dt.strftime("%d/%m")
        else:
            key = f"S{dt.isocalendar()[1]}-{dt.year}"
            label = f"Sem {dt.isocalendar()[1]}"

        timeline_map[key]["feedbacks"] += 1
        timeline_map[key]["notes"].append(f.note)
        timeline_map[key]["label"] = label
        if _is_treated(f):
            timeline_map[key]["traites"] += 1

        if f.note >= 4:
            timeline_map[key]["positifs"] += 1
        elif f.note == 3:
            timeline_map[key]["neutres"] += 1
        else:
            timeline_map[key]["negatifs"] += 1

    evolution_satisfaction: list[EvolutionPoint] = []
    evolution_volume: list[EvolutionPoint] = []

    for k, data in sorted(timeline_map.items()):
        notes = data["notes"]
        sat_pct = round(sum(1 for n in notes if n >= 4) / len(notes) * 100, 1) if notes else 0.0
        pt = EvolutionPoint(
            date=k,
            label=data["label"],
            feedbacks=data["feedbacks"],
            traites=data["traites"],
            satisfaction=sat_pct,
            positifs=data["positifs"],
            neutres=data["neutres"],
            negatifs=data["negatifs"],
        )
        evolution_satisfaction.append(pt)
        evolution_volume.append(pt)

    # Sentiments
    sent_counts: dict[str, int] = {"positif": 0, "neutre": 0, "negatif": 0}
    for a in analyses_current:
        s = a.sentiment.value if hasattr(a.sentiment, "value") else str(a.sentiment).lower()
        if s in sent_counts:
            sent_counts[s] += 1
        else:
            sent_counts["neutre"] += 1

    if not analyses_current and fbs_current:
        for f in fbs_current:
            if f.note >= 4:
                sent_counts["positif"] += 1
            elif f.note == 3:
                sent_counts["neutre"] += 1
            else:
                sent_counts["negatif"] += 1

    total_sent = sum(sent_counts.values()) or 1
    sentiments_res = [
        SentimentStats(
            sentiment=k,
            count=v,
            pourcentage=round(v / total_sent * 100, 1),
        )
        for k, v in sent_counts.items()
    ]

    # Themes
    theme_agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "sentiments": defaultdict(int)})
    for a in analyses_current:
        if a.theme_principal:
            th = a.theme_principal.lower().strip()
            theme_agg[th]["count"] += 1
            st = a.sentiment.value if hasattr(a.sentiment, "value") else str(a.sentiment)
            theme_agg[th]["sentiments"][st] += 1

    themes_res: list[ThemeStatsDetail] = []
    total_th_count = sum(t["count"] for t in theme_agg.values()) or 1
    for th_key, t_data in sorted(theme_agg.items(), key=lambda x: -x[1]["count"]):
        dominant_sent = max(t_data["sentiments"].items(), key=lambda x: x[1])[0] if t_data["sentiments"] else "neutre"
        themes_res.append(ThemeStatsDetail(
            theme=th_key,
            label=THEME_LABELS_MAP.get(th_key, th_key.replace("_", " ").capitalize()),
            count=t_data["count"],
            pourcentage=round(t_data["count"] / total_th_count * 100, 1),
            sentiment_predominant=dominant_sent,
        ))

    # Alertes
    impacted = []
    if critiques_curr > 0:
        impacted.append(AgenceImpacteeItem(
            agence_id=agence.id,
            agence_nom=agence.nom,
            ville=agence.ville,
            alertes_count=critiques_curr,
            satisfaction_rate=sat_curr,
        ))

    alertes_synthese = AlerteSyntheseDetail(
        total_critiques=critiques_curr,
        agences_impactees=impacted,
        evolution_pct=crit_ev,
        evolution_positive=crit_p_pos,
    )

    # Recommandations & Insights
    insights_ia: list[InsightIADetail] = []
    from app.models.recommandation import Recommandation
    recos = (
        db.query(Recommandation)
        .join(AnalyseIA, Recommandation.analyse_ia_id == AnalyseIA.id)
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .filter(Feedback.id.in_(cur_fb_ids))
        .order_by(Recommandation.date_generation.desc())
        .limit(3)
        .all()
        if cur_fb_ids
        else []
    )

    for r in recos:
        insights_ia.append(InsightIADetail(
            id=str(r.id),
            type="recommandation",
            titre="Recommandation IA",
            description=r.contenu,
            priorite=r.priorite.value if hasattr(r.priorite, "value") else str(r.priorite),
            agence_nom=agence.nom,
            date=r.date_generation.strftime("%d/%m/%Y"),
        ))

    if not insights_ia:
        if sat_curr >= 80:
            insights_ia.append(InsightIADetail(
                id="agency-positive",
                type="point_fort",
                titre="Performance Agence Remarquable",
                description=f"Votre agence atteint {sat_curr}% de satisfaction sur {total_curr} avis clients.",
                priorite="low",
                date=now.strftime("%d/%m/%Y"),
            ))
        elif total_curr > 0:
            insights_ia.append(InsightIADetail(
                id="agency-focus",
                type="point_vigilance",
                titre="Plan d'action accueil & fluidité",
                description=f"Concentrez les efforts de l'équipe sur le traitement des {attente_curr} avis en attente.",
                priorite="medium",
                date=now.strftime("%d/%m/%Y"),
            ))

    return StatsAgenceResponse(
        agence_id=agence.id,
        agence_nom=agence.nom,
        ville=agence.ville,
        organisation_nom=agence.organisation.nom if agence.organisation else "Orange",
        periode_jours=jours,
        periode_label=_period_label(jours),
        kpis=kpis,
        evolution_satisfaction=evolution_satisfaction,
        evolution_volume=evolution_volume,
        sentiments=sentiments_res,
        themes=themes_res,
        alertes_synthese=alertes_synthese,
        insights_ia=insights_ia,
    )


@router.get("/statistics/admin", response_model=StatsAdminResponse)
def get_statistics_admin(
    jours: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """
    Interface Statistiques de la Plateforme pour le Super Admin IKAN.
    STRICTEMENT AUCUNE DONNÉE INDIVIDUELLE OU PII — Uniquement des agrégats globaux et inter-organisations.
    """
    from collections import defaultdict
    from app.models.enums import CriticiteType

    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=jours)
    previous_start = current_start - timedelta(days=jours)
    previous_end = current_start

    # 1. Total Global
    orgs = db.query(Organisation).filter(Organisation.active == True).all()
    total_orgs_count = len(orgs)

    total_agences_count = db.query(func.count(Agence.id)).filter(Agence.active == True).scalar() or 0
    total_users_count = db.query(func.count(Utilisateur.id)).filter(Utilisateur.active == True).scalar() or 0

    # Feedbacks globaux
    fbs_curr = db.query(Feedback).filter(Feedback.date_soumission >= current_start, Feedback.date_soumission <= now).all()
    fbs_prev = db.query(Feedback).filter(Feedback.date_soumission >= previous_start, Feedback.date_soumission < previous_end).all()

    cur_fb_ids = [f.id for f in fbs_curr]
    prev_fb_ids = [f.id for f in fbs_prev]

    analyses_curr = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(cur_fb_ids)).all() if cur_fb_ids else []
    analyses_prev = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(prev_fb_ids)).all() if prev_fb_ids else []

    total_curr = len(fbs_curr)
    total_prev = len(fbs_prev)

    traites_curr = len(analyses_curr)
    traites_prev = len(analyses_prev)
    attente_curr = max(0, total_curr - traites_curr)

    taux_trait_curr = round(traites_curr / total_curr * 100, 1) if total_curr > 0 else 0.0
    taux_trait_prev = round(traites_prev / total_prev * 100, 1) if total_prev > 0 else 0.0

    pos_curr = sum(1 for f in fbs_curr if f.note >= 4)
    pos_prev = sum(1 for f in fbs_prev if f.note >= 4)
    sat_curr = round(pos_curr / total_curr * 100, 1) if total_curr > 0 else 0.0
    sat_prev = round(pos_prev / total_prev * 100, 1) if total_prev > 0 else 0.0

    critiques_curr = sum(1 for a in analyses_curr if a.criticite == CriticiteType.CRITIQUE)
    critiques_prev = sum(1 for a in analyses_prev if a.criticite == CriticiteType.CRITIQUE)

    total_ai_requests = db.query(func.count(AnalyseIA.id)).scalar() or 0

    tot_ev, tot_pos = _calc_kpi_trend(total_curr, total_prev)
    trt_ev, trt_pos = _calc_kpi_trend(traites_curr, traites_prev)
    tx_ev, tx_pos = _calc_kpi_trend(taux_trait_curr, taux_trait_prev, is_pct_diff=True)
    crit_ev, crit_p_pos = _calc_kpi_trend(critiques_curr, critiques_prev, invert_positive=True)

    kpis = {
        "organisations_actives": StatKPI(
            valeur=total_orgs_count,
            valeur_num=float(total_orgs_count),
            sous_titre="Comptes entreprises déployés",
        ),
        "total_agences": StatKPI(
            valeur=total_agences_count,
            valeur_num=float(total_agences_count),
            sous_titre="Points de vente et bornes connectées",
        ),
        "feedbacks_collectes": StatKPI(
            valeur=total_curr,
            valeur_num=float(total_curr),
            valeur_precedente=total_prev,
            evolution=tot_ev,
            is_positive=tot_pos,
            sous_titre="Volume global collecté sur la période",
        ),
        "feedbacks_traites": StatKPI(
            valeur=traites_curr,
            valeur_num=float(traites_curr),
            valeur_precedente=traites_prev,
            evolution=trt_ev,
            is_positive=trt_pos,
            sous_titre="Avis analysés par les modèles NLP",
        ),
        "feedbacks_attente": StatKPI(
            valeur=attente_curr,
            valeur_num=float(attente_curr),
            is_positive=attente_curr == 0,
            sous_titre="En attente de traitement réseau",
        ),
        "taux_traitement": StatKPI(
            valeur=f"{taux_trait_curr}%",
            valeur_num=taux_trait_curr,
            valeur_precedente=taux_trait_prev,
            evolution=tx_ev,
            is_positive=tx_pos,
            sous_titre="Taux moyen de couverture sémantique",
        ),
        "requetes_ia": StatKPI(
            valeur=total_ai_requests,
            valeur_num=float(total_ai_requests),
            sous_titre="Analyses & inférences IKAN AI exécutées",
        ),
        "utilisateurs_actifs": StatKPI(
            valeur=total_users_count,
            valeur_num=float(total_users_count),
            sous_titre="Gestionnaires CX et agences habilités",
        ),
        "alertes_generees": StatKPI(
            valeur=critiques_curr,
            valeur_num=float(critiques_curr),
            valeur_precedente=critiques_prev,
            evolution=crit_ev,
            is_positive=crit_p_pos,
            sous_titre="Alertes de criticité haute émises",
        ),
    }

    # Timeline globale
    _JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    timeline_map: dict[str, dict] = defaultdict(lambda: {
        "feedbacks": 0,
        "traites": 0,
        "notes": [],
        "positifs": 0,
        "neutres": 0,
        "negatifs": 0,
        "label": "",
    })

    analyses_set = set(a.feedback_id for a in analyses_curr)

    for f in fbs_curr:
        dt = f.date_soumission
        if jours <= 1:
            key = dt.strftime("%Hh")
            label = key
        elif jours <= 14:
            key = dt.strftime("%Y-%m-%d")
            label = f"{_JOURS_FR[dt.weekday()]} {dt.day}"
        elif jours <= 60:
            key = dt.strftime("%Y-%m-%d")
            label = dt.strftime("%d/%m")
        else:
            key = f"S{dt.isocalendar()[1]}-{dt.year}"
            label = f"Sem {dt.isocalendar()[1]}"

        timeline_map[key]["feedbacks"] += 1
        timeline_map[key]["notes"].append(f.note)
        timeline_map[key]["label"] = label
        if f.id in analyses_set:
            timeline_map[key]["traites"] += 1

        if f.note >= 4:
            timeline_map[key]["positifs"] += 1
        elif f.note == 3:
            timeline_map[key]["neutres"] += 1
        else:
            timeline_map[key]["negatifs"] += 1

    evolution_volume: list[EvolutionPoint] = []
    evolution_traitement: list[EvolutionPoint] = []

    for k, data in sorted(timeline_map.items()):
        notes = data["notes"]
        sat_pct = round(sum(1 for n in notes if n >= 4) / len(notes) * 100, 1) if notes else 0.0
        pt = EvolutionPoint(
            date=k,
            label=data["label"],
            feedbacks=data["feedbacks"],
            traites=data["traites"],
            satisfaction=sat_pct,
            positifs=data["positifs"],
            neutres=data["neutres"],
            negatifs=data["negatifs"],
        )
        evolution_volume.append(pt)
        evolution_traitement.append(pt)

    # Performance comparative des Organisations
    organisations_ranking: list[OrganisationRankDetail] = []
    for o in orgs:
        o_agences = db.query(Agence).filter(Agence.organisation_id == o.id).all()
        o_ag_ids = [a.id for a in o_agences]

        if o_ag_ids:
            o_qr_codes = db.query(QRCode).filter(QRCode.agence_id.in_(o_ag_ids)).all()
            o_qr_ids = [q.id for q in o_qr_codes]
            o_fbs = db.query(Feedback).filter(Feedback.qr_code_id.in_(o_qr_ids), Feedback.date_soumission >= current_start).all() if o_qr_ids else []
            o_fbs_prev = db.query(Feedback).filter(Feedback.qr_code_id.in_(o_qr_ids), Feedback.date_soumission >= previous_start, Feedback.date_soumission < previous_end).all() if o_qr_ids else []
        else:
            o_fbs = []
            o_fbs_prev = []

        o_f_ids = [f.id for f in o_fbs]
        o_analyses = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(o_f_ids)).all() if o_f_ids else []

        o_tot = len(o_fbs)
        o_traites = len(o_analyses)
        o_tx = round(o_traites / o_tot * 100, 1) if o_tot > 0 else 0.0

        o_pos = sum(1 for f in o_fbs if f.note >= 4)
        o_prev_pos = sum(1 for f in o_fbs_prev if f.note >= 4)
        o_sat = round(o_pos / o_tot * 100, 1) if o_tot > 0 else 0.0
        o_prev_sat = round(o_prev_pos / len(o_fbs_prev) * 100, 1) if o_fbs_prev else 0.0

        o_crit = sum(1 for a in o_analyses if a.criticite == CriticiteType.CRITIQUE)

        o_tend_str, o_tend_pos = _calc_kpi_trend(o_sat, o_prev_sat, is_pct_diff=True)

        organisations_ranking.append(OrganisationRankDetail(
            organisation_id=o.id,
            nom=o.nom,
            logo=o.logo,
            secteur=o.secteur_activite or o.secteur or "Général",
            agences_count=len(o_agences),
            feedbacks_collectes=o_tot,
            feedbacks_traites=o_traites,
            taux_traitement=o_tx,
            satisfaction_globale=o_sat,
            alertes_critiques=o_crit,
            tendance_val=o_tend_str,
            tendance_positive=o_tend_pos,
        ))

    organisations_ranking.sort(key=lambda x: -x.feedbacks_collectes)

    # Activité & IA metrics
    discordances_count = sum(1 for a in analyses_curr if a.discordance_detectee)
    suggestions_count = db.query(func.count(Suggestion.id)).scalar() or 0

    activite_plateforme = {
        "organisations_actives": total_orgs_count,
        "agences_actives": total_agences_count,
        "utilisateurs_actifs": total_users_count,
        "suggestions_soumises": suggestions_count,
        "derniere_analyse_utc": now.isoformat(),
    }

    utilisation_ia = {
        "moteur": "IKAN AI Core + HuggingFace Transformer",
        "analyses_total": total_ai_requests,
        "analyses_periode": traites_curr,
        "discordances_signalees": discordances_count,
        "taux_couverture_nlp": f"{taux_trait_curr}%",
        "statut_modele": "Opérationnel (Inférence synchrone & asynchrone)",
    }

    return StatsAdminResponse(
        periode_jours=jours,
        periode_label=_period_label(jours),
        kpis=kpis,
        evolution_volume=evolution_volume,
        evolution_traitement=evolution_traitement,
        organisations_ranking=organisations_ranking,
        activite_plateforme=activite_plateforme,
        utilisation_ia=utilisation_ia,
    )


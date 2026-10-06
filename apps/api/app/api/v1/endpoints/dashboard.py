"""
Endpoints Dashboard — KPIs et indicateurs de satisfaction (BF-09).
"""
from uuid import UUID
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import case, func

from app.services.acces_agence import verifier_acces_agence
from app.api.deps import (
    get_admin_user,
    get_current_active_user,
    get_cx_manager,
    get_cx_or_agency_manager,
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
from app.utils.stats import wilson_lower_bound
from app.services.dashboard_helpers import (
    _calc_kpi_trend,
    _cle_semaine_iso,
    _compter_utilisateurs_actifs,
    _libelles_semaines,
    _repartition_forfaits,
    _taux,
)
from app.schemas.dashboard import (
    DashboardAgence,
    DashboardSiege,
    KPIAgence,
    TendanceSatisfaction,
    ThemeStats,
    SentimentStats,
    DashboardAdminStats,
    RepartitionForfaitItem,
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
    OrganisationStructure,
    CompteurStructurel,
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
    """Dashboard complet pour un Agency Manager (sa seule agence) ou un CX Manager (agences de son organisation)."""
    verifier_acces_agence(db, current_user, agence_id)
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    date_debut = datetime.now(timezone.utc) - timedelta(days=jours)

    # Feedbacks de la période
    feedbacks = (
        db.query(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .options(joinedload(Feedback.demande_contact))
        .filter(
            QRCode.agence_id == agence_id,
            Feedback.date_soumission >= date_debut,
        )
        .all()
    )

    total = len(feedbacks)
    feedbacks_a_traiter = sum(
        1
        for feedback in feedbacks
        if feedback.statut_traitement != "resolu"
        or (feedback.demande_contact is not None and not feedback.demande_contact.traitee)
    )
    feedbacks_pris_en_charge = sum(1 for feedback in feedbacks if feedback.statut_traitement != "nouveau")
    taux_prise_en_charge = round(feedbacks_pris_en_charge / total * 100, 1) if total else None
    actions_ouvertes = sum(
        1 for feedback in feedbacks if feedback.action_a_prendre and not feedback.action_realisee
    )
    # None si aucun avis : une absence de données n'est jamais un « 0 % » de satisfaction.
    taux = _taux(sum(1 for f in feedbacks if f.note >= 4), total)

    # Analyses IA
    analyses_ids = [f.id for f in feedbacks]
    analyses = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(analyses_ids)).all()

    sentiments_count = {"positif": 0, "neutre": 0, "negatif": 0}
    for analyse in analyses:
        sentiment = analyse.sentiment.value if hasattr(analyse.sentiment, "value") else str(analyse.sentiment)
        sentiment = sentiment.lower()
        if sentiment in sentiments_count:
            sentiments_count[sentiment] += 1
    total_analyses = sum(sentiments_count.values())
    sentiments = [
        SentimentStats(
            sentiment=sentiment,
            count=count,
            pourcentage=round(count / total_analyses * 100, 1) if total_analyses else 0,
        )
        for sentiment, count in sentiments_count.items()
        if total_analyses
    ]

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
        feedbacks_a_traiter=feedbacks_a_traiter,
        taux_prise_en_charge=taux_prise_en_charge,
        actions_ouvertes=actions_ouvertes,
        tendances=tendances,
        themes=themes,
        sentiments=sentiments,
        discordances=discordances,
    )


@router.get("/siege", response_model=DashboardSiege)
def dashboard_siege(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_manager),
    jours: int = Query(30, ge=1, le=365),
):
    """Dashboard vue siège — CX Manager UNIQUEMENT (données clients : l'Admin reçoit 403)."""
    date_debut = datetime.now(timezone.utc) - timedelta(days=jours)

    query_agences = db.query(Agence).filter(Agence.active == True)
    if current_user.organisation_id:
        query_agences = query_agences.filter(Agence.organisation_id == current_user.organisation_id)

    agences = query_agences.all()

    agence_ids = [agence.id for agence in agences]
    feedback_rows = (
        db.query(Feedback, QRCode.agence_id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(QRCode.agence_id.in_(agence_ids), Feedback.date_soumission >= date_debut)
        .all()
        if agence_ids else []
    )
    all_feedbacks = [feedback for feedback, _ in feedback_rows]
    feedback_agence = {feedback.id: agence_id for feedback, agence_id in feedback_rows}
    feedback_count_by_agence: dict[UUID, int] = {}
    positive_count_by_agence: dict[UUID, int] = {}
    for feedback, agence_id in feedback_rows:
        feedback_count_by_agence[agence_id] = feedback_count_by_agence.get(agence_id, 0) + 1
        if feedback.note >= 4:
            positive_count_by_agence[agence_id] = positive_count_by_agence.get(agence_id, 0) + 1

    feedback_ids = [feedback.id for feedback in all_feedbacks]
    all_analyses = (
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(feedback_ids)).all()
        if feedback_ids else []
    )
    negative_count_by_agence: dict[UUID, int] = {}
    for analyse in all_analyses:
        if analyse.sentiment == SentimentType.NEGATIF:
            agence_id = feedback_agence.get(analyse.feedback_id)
            if agence_id:
                negative_count_by_agence[agence_id] = negative_count_by_agence.get(agence_id, 0) + 1

    suggestion_count_by_agence = dict(
        db.query(QRCode.agence_id, func.count(Suggestion.id))
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .join(Suggestion, Suggestion.feedback_id == Feedback.id)
        .filter(QRCode.agence_id.in_(agence_ids), Feedback.date_soumission >= date_debut)
        .group_by(QRCode.agence_id)
        .all()
    ) if agence_ids else {}

    kpis = []
    for agence in agences:
        total = feedback_count_by_agence.get(agence.id, 0)
        positifs = positive_count_by_agence.get(agence.id, 0)
        taux = _taux(positifs, total)
        kpis.append(KPIAgence(
            agence_id=agence.id,
            agence_nom=agence.nom,
            ville=agence.ville,
            taux_satisfaction=taux,
            nombre_feedbacks=total,
            nombre_negatifs=negative_count_by_agence.get(agence.id, 0),
            nombre_suggestions=suggestion_count_by_agence.get(agence.id, 0),
            wilson_score=wilson_lower_bound(positifs, total),
            latitude=agence.latitude,
            longitude=agence.longitude,
        ))

    total_global = len(all_feedbacks)
    taux_global = _taux(sum(1 for f in all_feedbacks if f.note >= 4), total_global)

    from app.models.enums import IdeaStatus
    idees_attente = db.query(Suggestion).filter(
        Suggestion.statut == IdeaStatus.NOUVEAU,
        Suggestion.feedback_id.in_(
            db.query(Feedback.id)
            .join(QRCode, Feedback.qr_code_id == QRCode.id)
            .join(Agence, QRCode.agence_id == Agence.id)
            .filter(Agence.organisation_id == current_user.organisation_id)
        ),
    ).count()

    tendances = _compute_tendances(all_feedbacks, jours)

    # Calcul des thèmes et sentiments globaux (toutes agences)
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

    # Tendances vs. période précédente (mêmes durée, réutilise _calc_kpi_trend
    # comme pour /statistics/cx plutôt que de dupliquer la logique de calcul)
    date_debut_prev = date_debut - timedelta(days=jours)
    prev_feedback_stats = (
        db.query(
            func.count(Feedback.id),
            func.coalesce(func.sum(case((Feedback.note >= 4, 1), else_=0)), 0),
        )
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id.in_(agence_ids),
            Feedback.date_soumission >= date_debut_prev,
            Feedback.date_soumission < date_debut,
        )
        .one()
        if agence_ids else (0, 0)
    )
    total_prev, positifs_prev = map(int, prev_feedback_stats)
    taux_prev = _taux(positifs_prev, total_prev)
    evol_feedbacks, evol_feedbacks_pos = _calc_kpi_trend(total_global, total_prev)
    evol_satisfaction, evol_satisfaction_pos = _calc_kpi_trend(taux_global, taux_prev, is_pct_diff=True)

    # Classement par score de Wilson décroissant (fiabilité statistique du
    # taux de satisfaction), CSAT brut en second critère pour départager les
    # égalités ou scores très proches — pas de score composite, un tri
    # primaire/secondaire simple. Le score de Wilson est exposé dans
    # KPIAgence.wilson_score pour le tri Top/Flop du frontend, sans affichage.
    # Les agences sans avis (taux None) ferment la marche.
    agences_triees = sorted(
        kpis,
        key=lambda kpi: (
            -kpi.wilson_score,
            -(kpi.taux_satisfaction if kpi.taux_satisfaction is not None else -1),
        ),
    )

    return DashboardSiege(
        organisation_id=current_user.organisation_id,
        periode=f"{jours} derniers jours",
        feedbacks_total=total_global,
        taux_satisfaction_global=taux_global,
        idees_en_attente=idees_attente,
        agences_actives=len(agences),
        agences=agences_triees,
        tendances=tendances,
        themes_globaux=themes_globaux,
        sentiments_globaux=sentiments_globaux,
        nombre_discordances=nombre_discordances,
        nombre_critiques=nombre_critiques,
        evolution_feedbacks_total=evol_feedbacks,
        evolution_feedbacks_total_positive=evol_feedbacks_pos,
        evolution_satisfaction=evol_satisfaction,
        evolution_satisfaction_positive=evol_satisfaction_pos,
    )


@router.get("/admin", response_model=DashboardAdminStats)
def dashboard_admin(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """
    Dashboard de l'Administrateur Système — STRICTEMENT STRUCTUREL.
    Comptes, organisations, agences, forfaits : jamais de donnée dérivée des
    feedbacks (volume, satisfaction, traitement, alertes, tendances, sentiments),
    à aucun niveau d'agrégation (principe RBAC fondateur du projet).
    """
    from app.models.plan import Plan

    orgs = db.query(Organisation).order_by(Organisation.nom.asc()).all()
    orgs_actives = [o for o in orgs if o.active]
    plans_par_id = {p.id: p for p in db.query(Plan).all()}

    total_agences = db.query(func.count(Agence.id)).filter(Agence.active == True).scalar() or 0  # noqa: E712

    def _item(u: Utilisateur, libelle_role: str, agence_nom: str | None, agences_count: int) -> AdminUserItem:
        return AdminUserItem(
            id=u.id,
            nom=u.nom,
            prenom=u.prenom,
            email=u.email,
            role=libelle_role,
            agence_nom=agence_nom,
            agences_count=agences_count,
            active=u.active,
            derniere_connexion=u.derniere_connexion.isoformat() if u.derniere_connexion else None,
        )

    orgs_overview: list[AdminOrganisationHierarchy] = []
    for o in orgs:
        org_users = db.query(Utilisateur).filter(Utilisateur.organisation_id == o.id).all()
        cx_users = [u for u in org_users if u.role == UserRole.CX_MANAGER]
        agency_users = [u for u in org_users if u.role == UserRole.AGENCY_MANAGER]

        org_agences = db.query(Agence).filter(Agence.organisation_id == o.id).all()
        agences_map = {a.id: a for a in org_agences}

        cx_items = [_item(cx, "CX Manager", None, len(org_agences)) for cx in cx_users]
        agency_items = []
        for am in agency_users:
            am_ag = agences_map.get(am.agence_id) if am.agence_id else None
            agency_items.append(_item(am, "Agency Manager", am_ag.nom if am_ag else "—", 1 if am_ag else 0))

        agence_items = [
            AdminAgenceItem(
                id=ag.id,
                nom=ag.nom,
                ville=ag.ville,
                adresse=ag.adresse,
                active=ag.active,
                seuil_alerte=ag.seuil_alerte,
            )
            for ag in org_agences
        ]

        plan = plans_par_id.get(o.plan_id)
        orgs_overview.append(AdminOrganisationHierarchy(
            id=o.id,
            nom=o.nom,
            logo=o.logo,
            secteur_activite=o.secteur_activite or o.secteur or "Général",
            pays_region=o.pays_region or "International",
            email_pro=o.email_pro or o.email or "",
            active=o.active,
            created_at=o.created_at.isoformat() if o.created_at else None,
            plan_code=plan.code if plan else None,
            plan_nom=plan.nom if plan else None,
            cx_managers_count=len(cx_users),
            agency_managers_count=len(agency_users),
            agences_count=len(org_agences),
            cx_managers=cx_items,
            agency_managers=agency_items,
            agences=agence_items,
            users=cx_items + agency_items,
        ))

    return DashboardAdminStats(
        total_organisations=len(orgs_actives),
        total_agences=total_agences,
        total_cx_managers=_compter_utilisateurs_actifs(db, UserRole.CX_MANAGER),
        total_agency_managers=_compter_utilisateurs_actifs(db, UserRole.AGENCY_MANAGER),
        total_utilisateurs_actifs=_compter_utilisateurs_actifs(db),
        repartition_forfaits=_repartition_forfaits(db, orgs_actives),
        organisations_overview=orgs_overview,
    )


def _compute_tendances(feedbacks: list, jours: int) -> list[TendanceSatisfaction]:
    """Tendances de satisfaction par jour (≤ 30 jours) ou par semaine ISO (au-delà).

    Les semaines sont regroupées par clé « AAAA-Www » (année ISO) et triées
    chronologiquement : la semaine 52 de 2025 précède la semaine 1 de 2026, et deux
    semaines de même numéro d'années différentes ne sont jamais fusionnées. `date`
    porte le libellé affiché (« Semaine 9 », avec l'année si la série en couvre deux).
    Seules les périodes contenant au moins un avis sont renvoyées (taux toujours défini).
    """
    from collections import defaultdict
    bucket: dict[str, list] = defaultdict(list)
    hebdomadaire = jours > 30

    for f in feedbacks:
        key = _cle_semaine_iso(f.date_soumission) if hebdomadaire else f.date_soumission.strftime("%Y-%m-%d")
        bucket[key].append(f.note)

    libelles = _libelles_semaines(bucket.keys(), prefixe="Semaine") if hebdomadaire else {}
    return [
        TendanceSatisfaction(
            date=libelles.get(key, key),
            taux=_taux(sum(1 for n in notes if n >= 4), len(notes)),
            nombre_feedbacks=len(notes),
        )
        for key, notes in sorted(bucket.items())
    ]


# Preserve the router's public surface while keeping statistics handlers isolated.
from app.api.v1.endpoints.dashboard_statistics import router as statistics_router

router.routes.extend(statistics_router.routes)


# ==============================================================================
# ENDPOINTS STATISTIQUES & ANALYSES (RBAC STRICT & AGRÉGATIONS POSTGRESQL)
# ==============================================================================

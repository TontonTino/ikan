"""
Endpoints Dashboard — KPIs et indicateurs de satisfaction (BF-09).
"""
from uuid import UUID
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

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
    current_user: Utilisateur = Depends(get_cx_manager),
    jours: int = Query(30, ge=1, le=365),
):
    """Dashboard vue siège — CX Manager UNIQUEMENT (données clients : l'Admin reçoit 403)."""
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
        positifs = sum(1 for f in feedbacks if f.note >= 4)
        taux = round(positifs / total * 100, 1) if total else 0.0
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
            # Score de Wilson : sert au classement (API et Top/Flop du
            # frontend) par fiabilité statistique plutôt que par CSAT brut —
            # une agence à 100% sur 2 avis ne doit pas dominer une agence à
            # 90% sur 200 avis. Jamais affiché.
            wilson_score=wilson_lower_bound(positifs, total),
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

    # Tendances vs. période précédente (mêmes durée, réutilise _calc_kpi_trend
    # comme pour /statistics/cx plutôt que de dupliquer la logique de calcul)
    date_debut_prev = date_debut - timedelta(days=jours)
    agence_ids = [a.id for a in agences]
    prev_feedbacks = (
        db.query(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id.in_(agence_ids),
            Feedback.date_soumission >= date_debut_prev,
            Feedback.date_soumission < date_debut,
        )
        .all()
        if agence_ids else []
    )
    total_prev = len(prev_feedbacks)
    taux_prev = (
        round(sum(1 for f in prev_feedbacks if f.note >= 4) / total_prev * 100, 1)
        if total_prev else 0.0
    )
    prev_fb_ids = [f.id for f in prev_feedbacks]
    prev_analyses = db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(prev_fb_ids)).all() if prev_fb_ids else []
    nombre_critiques_prev = sum(1 for a in prev_analyses if a.criticite == CriticiteType.CRITIQUE)

    taux_resolution_curr = (
        round((total_global - nombre_critiques) / total_global * 100, 1) if total_global else 100.0
    )
    taux_resolution_prev = (
        round((total_prev - nombre_critiques_prev) / total_prev * 100, 1) if total_prev else 100.0
    )

    evol_feedbacks, evol_feedbacks_pos = _calc_kpi_trend(total_global, total_prev)
    evol_satisfaction, evol_satisfaction_pos = _calc_kpi_trend(taux_global, taux_prev, is_pct_diff=True)
    evol_resolution, evol_resolution_pos = _calc_kpi_trend(taux_resolution_curr, taux_resolution_prev, is_pct_diff=True)

    # Classement par score de Wilson décroissant (fiabilité statistique du
    # taux de satisfaction), CSAT brut en second critère pour départager les
    # égalités ou scores très proches — pas de score composite, un tri
    # primaire/secondaire simple. Le score de Wilson est exposé dans
    # KPIAgence.wilson_score pour le tri Top/Flop du frontend, sans affichage.
    agences_triees = sorted(
        kpis, key=lambda kpi: (-kpi.wilson_score, -kpi.taux_satisfaction),
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
        evolution_taux_resolution=evol_resolution,
        evolution_taux_resolution_positive=evol_resolution_pos,
    )


def _repartition_forfaits(db: Session, organisations: list) -> list[RepartitionForfaitItem]:
    """Nombre d'organisations par forfait (les 4 forfaits sont toujours listés, même à 0)."""
    from collections import Counter
    from app.models.plan import Plan

    plans = db.query(Plan).order_by(Plan.ordre).all()
    compteur = Counter(o.plan_id for o in organisations)
    return [RepartitionForfaitItem(code=p.code, nom=p.nom, nombre=compteur.get(p.id, 0)) for p in plans]


def _compter_utilisateurs_actifs(db: Session, role: UserRole | None = None) -> int:
    requete = db.query(func.count(Utilisateur.id)).filter(Utilisateur.active == True)  # noqa: E712
    if role is not None:
        requete = requete.filter(Utilisateur.role == role)
    return requete.scalar() or 0


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
    current_user: Utilisateur = Depends(get_cx_manager),
):
    """
    Interface Statistiques & Analyses pour le CX Manager (Vue Réseau / Organisation).
    CX Manager UNIQUEMENT : données clients, l'Admin reçoit 403.
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
    agence_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Interface Statistiques & Analyses pour une agence précise : l'Agency Manager
    consulte sa propre agence (agence_id absent, retombe sur current_user.agence_id) ;
    le CX Manager peut consulter n'importe quelle agence de SON organisation en
    passant `agence_id` explicitement (page agence unifiée) — vérifié par
    verifier_acces_agence, même garde que /dashboard/agence/{agence_id}.
    """
    from collections import defaultdict
    from app.models.enums import CriticiteType

    target_agence_id = agence_id or current_user.agence_id
    if not target_agence_id:
        raise HTTPException(status_code=400, detail="Aucune agence assignée à cet utilisateur.")
    verifier_acces_agence(db, current_user, target_agence_id)

    agence = db.query(Agence).filter(Agence.id == target_agence_id).first()
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
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """
    Statistiques de la plateforme pour l'Administrateur — STRICTEMENT STRUCTURELLES.
    Comptes, organisations, agences, forfaits. Aucune donnée dérivée des feedbacks
    (volume, satisfaction, traitement, alertes, sentiments, usage IA), à aucun niveau
    d'agrégation : l'Admin n'a aucun accès aux données clients (principe RBAC fondateur).
    """
    from app.models.plan import Plan

    orgs = db.query(Organisation).filter(Organisation.active == True).all()  # noqa: E712
    plans_par_id = {p.id: p for p in db.query(Plan).all()}

    agences_par_org = dict(
        db.query(Agence.organisation_id, func.count(Agence.id))
        .filter(Agence.active == True)  # noqa: E712
        .group_by(Agence.organisation_id)
        .all()
    )
    utilisateurs_par_org = dict(
        db.query(Utilisateur.organisation_id, func.count(Utilisateur.id))
        .filter(Utilisateur.active == True)  # noqa: E712
        .group_by(Utilisateur.organisation_id)
        .all()
    )

    total_agences = sum(agences_par_org.values())
    total_utilisateurs = _compter_utilisateurs_actifs(db)
    total_cx = _compter_utilisateurs_actifs(db, UserRole.CX_MANAGER)
    total_agency = _compter_utilisateurs_actifs(db, UserRole.AGENCY_MANAGER)

    kpis = {
        "organisations_actives": CompteurStructurel(valeur=len(orgs), sous_titre="Comptes entreprises déployés"),
        "total_agences": CompteurStructurel(valeur=total_agences, sous_titre="Points de vente et bornes connectées"),
        "utilisateurs_actifs": CompteurStructurel(
            valeur=total_utilisateurs, sous_titre="Comptes actifs (Admin, CX Managers, Agency Managers)"
        ),
        "cx_managers": CompteurStructurel(valeur=total_cx, sous_titre="Responsables expérience client (siège)"),
        "agency_managers": CompteurStructurel(valeur=total_agency, sous_titre="Responsables d'agence"),
    }

    organisations = []
    for o in orgs:
        plan = plans_par_id.get(o.plan_id)
        organisations.append(OrganisationStructure(
            organisation_id=o.id,
            nom=o.nom,
            logo=o.logo,
            secteur=o.secteur_activite or o.secteur or "Général",
            agences_count=agences_par_org.get(o.id, 0),
            utilisateurs_count=utilisateurs_par_org.get(o.id, 0),
            plan_code=plan.code if plan else None,
            plan_nom=plan.nom if plan else None,
        ))
    organisations.sort(key=lambda x: (-x.agences_count, x.nom.lower()))

    return StatsAdminResponse(
        kpis=kpis,
        repartition_forfaits=_repartition_forfaits(db, orgs),
        organisations=organisations,
    )

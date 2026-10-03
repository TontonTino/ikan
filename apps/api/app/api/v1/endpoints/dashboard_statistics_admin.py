"""
Endpoints Dashboard — KPIs et indicateurs de satisfaction (BF-09).
"""
from uuid import UUID
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
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

from app.services.dashboard_helpers import (
    _calc_kpi_trend, _compter_utilisateurs_actifs, _period_label, _repartition_forfaits,
)

from app.api.v1.endpoints.dashboard_statistics_shared import THEME_LABELS_MAP

router = APIRouter()

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

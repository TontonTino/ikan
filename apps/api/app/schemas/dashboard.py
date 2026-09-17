"""
Schémas Pydantic pour les données du dashboard et statistiques d'analyse (BF-09).
"""
from pydantic import BaseModel
from typing import List, Optional, Any
import uuid


class KPIAgence(BaseModel):
    agence_id: uuid.UUID
    agence_nom: str
    ville: str | None
    taux_satisfaction: float
    nombre_feedbacks: int
    nombre_negatifs: int
    nombre_suggestions: int
    latitude: float | None = None
    longitude: float | None = None


class TendanceSatisfaction(BaseModel):
    date: str
    taux: float
    nombre_feedbacks: int


class ThemeStats(BaseModel):
    theme: str
    count: int
    pourcentage: float


class DashboardAgence(BaseModel):
    """Vue dashboard pour un Agency Manager."""
    agence_id: uuid.UUID
    agence_nom: str
    periode: str
    taux_satisfaction: float
    nombre_feedbacks: int
    nombre_negatifs: int
    nombre_critiques: int
    nombre_suggestions: int
    tendances: List[TendanceSatisfaction]
    themes: List[ThemeStats]
    discordances: int


class SentimentStats(BaseModel):
    sentiment: str
    count: int
    pourcentage: float


class DashboardSiege(BaseModel):
    """Vue dashboard pour le CX Manager (vue siège)."""
    organisation_id: uuid.UUID
    periode: str
    feedbacks_total: int
    taux_satisfaction_global: float
    idees_en_attente: int
    agences_actives: int
    agences: List[KPIAgence]
    tendances: List[TendanceSatisfaction]
    themes_globaux: List[ThemeStats] = []
    sentiments_globaux: List[SentimentStats] = []
    nombre_discordances: int = 0
    nombre_critiques: int = 0


class ActivityPoint(BaseModel):
    date: str
    feedbacks: int
    users: int


class AdminUserItem(BaseModel):
    id: uuid.UUID
    nom: str
    prenom: str
    email: str
    role: str
    agence_nom: str | None = None
    agences_count: int = 0
    feedbacks_recus: int = 0
    feedbacks_traites: int = 0
    active: bool = True
    derniere_connexion: str | None = None


class AdminAgenceItem(BaseModel):
    id: uuid.UUID
    nom: str
    ville: str | None = None
    adresse: str | None = None
    active: bool = True
    seuil_alerte: float = 80.0
    feedbacks_recus: int = 0
    feedbacks_traites: int = 0
    taux_satisfaction: float = 0.0


class AdminOrganisationHierarchy(BaseModel):
    id: uuid.UUID
    nom: str
    logo: str | None = None
    secteur_activite: str | None = None
    pays_region: str | None = None
    email_pro: str | None = None
    active: bool = True
    created_at: str | None = None
    cx_managers_count: int = 0
    agency_managers_count: int = 0
    agences_count: int = 0
    feedbacks_recus: int = 0
    feedbacks_traites: int = 0
    taux_traitement: float = 0.0
    cx_managers: List[AdminUserItem] = []
    agency_managers: List[AdminUserItem] = []
    agences: List[AdminAgenceItem] = []
    users: List[AdminUserItem] = []


class DashboardAdminStats(BaseModel):
    """Vue dashboard pour l'Administrateur Système."""
    total_feedbacks: int
    processed_feedbacks: int
    feedbacks_trend: str | None = None
    feedbacks_trend_positive: bool = True
    processed_trend: str | None = None
    processed_trend_positive: bool = True
    satisfaction_globale: str
    satisfaction_trend: str | None = None
    satisfaction_trend_positive: bool = True
    total_organisations: int
    organisations_trend: str | None = None
    organisations_trend_positive: bool = True
    total_cx_managers: int
    cx_managers_trend: str | None = None
    cx_managers_trend_positive: bool = True
    total_alertes: int
    alertes_trend: str | None = None
    alertes_trend_positive: bool = False
    activity_7d: List[ActivityPoint]
    activity_30d: List[ActivityPoint]
    activity_90d: List[ActivityPoint]
    organisations_overview: List[AdminOrganisationHierarchy] = []


# ==============================================================================
# SCHÉMAS SPÉCIFIQUES POUR L'INTERFACE "STATISTIQUES & ANALYSES"
# ==============================================================================

class StatKPI(BaseModel):
    valeur: str | int | float
    valeur_num: float = 0.0
    valeur_precedente: float | int | None = None
    evolution: str | None = None
    is_positive: bool = True
    periode_comparaison: str = "vs. période précédente"
    sous_titre: str | None = None


class EvolutionPoint(BaseModel):
    date: str
    label: str
    feedbacks: int = 0
    traites: int = 0
    satisfaction: float = 0.0
    positifs: int = 0
    neutres: int = 0
    negatifs: int = 0


class ThemeStatsDetail(BaseModel):
    theme: str
    label: str
    count: int
    pourcentage: float
    sentiment_predominant: str = "neutre"


class AgenceRankDetail(BaseModel):
    agence_id: uuid.UUID
    agence_nom: str
    ville: str | None = None
    satisfaction_rate: float = 0.0
    total_feedbacks: int = 0
    feedbacks_traites: int = 0
    taux_traitement: float = 0.0
    alertes_critiques: int = 0
    tendance_val: str | None = None
    tendance_positive: bool = True


class AgenceImpacteeItem(BaseModel):
    agence_id: uuid.UUID
    agence_nom: str
    ville: str | None = None
    alertes_count: int = 0
    satisfaction_rate: float = 0.0


class AlerteSyntheseDetail(BaseModel):
    total_critiques: int = 0
    agences_impactees: List[AgenceImpacteeItem] = []
    evolution_pct: str | None = None
    evolution_positive: bool = True


class InsightIADetail(BaseModel):
    id: str
    type: str  # 'point_fort' | 'recommandation' | 'point_vigilance' | 'synthese'
    titre: str
    description: str
    priorite: str = "medium"
    agence_nom: str | None = None
    date: str | None = None


class OrganisationRankDetail(BaseModel):
    organisation_id: uuid.UUID
    nom: str
    logo: str | None = None
    secteur: str | None = None
    agences_count: int = 0
    feedbacks_collectes: int = 0
    feedbacks_traites: int = 0
    taux_traitement: float = 0.0
    satisfaction_globale: float = 0.0
    alertes_critiques: int = 0
    tendance_val: str | None = None
    tendance_positive: bool = True


class StatsCXResponse(BaseModel):
    organisation_id: uuid.UUID | None
    organisation_nom: str | None
    periode_jours: int
    periode_label: str
    agence_filtree_id: uuid.UUID | None = None
    agence_filtree_nom: str | None = None
    kpis: dict[str, StatKPI]
    evolution_satisfaction: List[EvolutionPoint]
    evolution_volume: List[EvolutionPoint]
    sentiments: List[SentimentStats]
    themes: List[ThemeStatsDetail]
    agences_ranking: List[AgenceRankDetail]
    alertes_synthese: AlerteSyntheseDetail
    insights_ia: List[InsightIADetail]


class StatsAgenceResponse(BaseModel):
    agence_id: uuid.UUID
    agence_nom: str
    ville: str | None = None
    organisation_nom: str | None = None
    periode_jours: int
    periode_label: str
    kpis: dict[str, StatKPI]
    evolution_satisfaction: List[EvolutionPoint]
    evolution_volume: List[EvolutionPoint]
    sentiments: List[SentimentStats]
    themes: List[ThemeStatsDetail]
    alertes_synthese: AlerteSyntheseDetail
    insights_ia: List[InsightIADetail]


class StatsAdminResponse(BaseModel):
    periode_jours: int
    periode_label: str
    kpis: dict[str, StatKPI]
    evolution_volume: List[EvolutionPoint]
    evolution_traitement: List[EvolutionPoint]
    organisations_ranking: List[OrganisationRankDetail]
    activite_plateforme: dict[str, Any]
    utilisation_ia: dict[str, Any]

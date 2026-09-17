// Types TypeScript pour IKAN AI Dashboard

export type UserRole = 'admin' | 'cx_manager' | 'agency_manager';
export type SentimentType = 'positif' | 'neutre' | 'negatif';
export type CriticiteType = 'faible' | 'moyenne' | 'elevee' | 'critique';
export type IdeaStatus = 'nouveau' | 'en_cours' | 'traite' | 'rejete';
export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface User {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  role: UserRole;
  organisation_id: string;
  agence_id?: string;
  organisation_nom?: string;
  organisation_logo?: string;
  agence_nom?: string;
}


export interface Organisation {
  id: string;
  nom: string;
  logo?: string;
  secteur_activite: string;
  secteur?: string;
  pays_region: string;
  email_pro: string;
  email?: string;
  active: boolean;
  created_at: string;
  date_creation?: string;
}

export interface Agence {
  id: string;
  organisation_id: string;
  nom: string;
  adresse?: string;
  ville?: string;
  latitude?: number;
  longitude?: number;
  active: boolean;
  seuil_alerte: number;
  date_creation: string;
  qr_code_token?: string;
  qr_code_url?: string;
}

export type StatutTraitement = 'nouveau' | 'en_traitement' | 'en_cours' | 'resolu';

export interface HistoriqueFeedback {
  id: string;
  feedback_id: string;
  utilisateur_id?: string;
  auteur_nom: string;
  auteur_role: string;
  agence_nom?: string;
  type_evenement: string;
  ancien_statut?: string;
  nouveau_statut?: string;
  details?: string;
  date_evenement: string;
}

export interface ReponseClient {
  id: string;
  feedback_id: string;
  utilisateur_id?: string;
  auteur_nom: string;
  auteur_role: string;
  canal: 'telephone' | 'email' | 'whatsapp' | 'sms' | string;
  contenu: string;
  date_envoi: string;
}

export interface NoteInterne {
  id: string;
  date: string;
  auteur: string;
  texte: string;
}

export interface DemandeContact {
  id: string;
  nom?: string;
  telephone?: string;
  email?: string;
  souhaite_etre_rappele: boolean;
  traitee: boolean;
}

export interface Feedback {
  id: string;
  qr_code_id: string;
  agence_id?: string;
  agence_nom?: string;
  note: number;
  commentaire?: string;
  date_soumission: string;
  statut_traitement?: StatutTraitement;
  assigne_a_id?: string;
  assigne_a_nom?: string;
  date_assignation?: string;
  date_resolution?: string;
  action_a_prendre?: string;
  action_realisee?: boolean;
  suggestion_agence?: string;
  suggestion_agence_auteur?: string;
  suggestion_agence_date?: string;
  notes_internes?: NoteInterne[];
  discordance_status?: 'detectee' | 'confirmee' | 'traitee_faux_positif';
  analyse_ia?: {
    id: string;
    sentiment: SentimentType;
    criticite: CriticiteType;
    theme_principal?: string;
    discordance_detectee: boolean;
    score_sentiment?: number;
  };
  demande_contact?: DemandeContact;
}

export interface AnalyseIA {
  id: string;
  feedback_id: string;
  sentiment: SentimentType;
  criticite: CriticiteType;
  theme_principal?: string;
  discordance_detectee: boolean;
  score_sentiment?: number;
  date_analyse: string;
}

export interface Suggestion {
  id: string;
  feedback_id: string;
  contenu: string;
  statut: IdeaStatus;
  date_soumission: string;
  date_traitement?: string;
  notes_internes?: string;
}

export interface Recommandation {
  id: string;
  analyse_ia_id: string;
  contenu: string;
  priorite: PriorityLevel;
  date_generation: string;
  traitee: boolean;
}

export interface KPIAgence {
  agence_id: string;
  agence_nom: string;
  ville?: string;
  taux_satisfaction: number;
  nombre_feedbacks: number;
  nombre_negatifs: number;
  nombre_suggestions: number;
  latitude?: number;
  longitude?: number;
}

export interface TendanceSatisfaction {
  date: string;
  taux: number;
  nombre_feedbacks: number;
}

export interface DashboardAgence {
  agence_id: string;
  agence_nom: string;
  periode: string;
  taux_satisfaction: number;
  nombre_feedbacks: number;
  nombre_negatifs: number;
  nombre_critiques: number;
  nombre_suggestions: number;
  tendances: TendanceSatisfaction[];
  themes: { theme: string; count: number; pourcentage: number }[];
  discordances: number;
}

export interface DashboardSiege {
  organisation_id: string;
  periode: string;
  feedbacks_total: number;
  taux_satisfaction_global: number;
  idees_en_attente: number;
  agences_actives: number;
  agences: KPIAgence[];
  tendances: TendanceSatisfaction[];
  themes_globaux: { theme: string; count: number; pourcentage: number }[];
  sentiments_globaux: { sentiment: string; count: number; pourcentage: number }[];
  nombre_discordances: number;
  nombre_critiques: number;
}

export interface Alerte {
  agence_id: string;
  agence_nom: string;
  taux_actuel: number;
  seuil: number;
  message: string;
}

export interface ActivityPoint {
  date: string;
  feedbacks: number;
  users: number;
}

export interface AdminUserItem {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  agence_nom?: string | null;
  agences_count: number;
  feedbacks_recus: number;
  feedbacks_traites: number;
  active: boolean;
  derniere_connexion?: string | null;
}

export interface AdminAgenceItem {
  id: string;
  nom: string;
  ville?: string | null;
  adresse?: string | null;
  active: boolean;
  seuil_alerte: number;
  feedbacks_recus: number;
  feedbacks_traites: number;
  taux_satisfaction: number;
}

export interface AdminOrganisationHierarchy {
  id: string;
  nom: string;
  logo?: string | null;
  secteur_activite?: string | null;
  pays_region?: string | null;
  email_pro?: string | null;
  active: boolean;
  created_at?: string | null;
  cx_managers_count: number;
  agency_managers_count: number;
  agences_count: number;
  feedbacks_recus: number;
  feedbacks_traites: number;
  taux_traitement: number;
  cx_managers: AdminUserItem[];
  agency_managers: AdminUserItem[];
  agences: AdminAgenceItem[];
  users: AdminUserItem[];
}

export interface DashboardAdminStats {
  total_feedbacks: number;
  processed_feedbacks: number;
  feedbacks_trend: string | null;
  feedbacks_trend_positive: boolean;
  processed_trend: string | null;
  processed_trend_positive: boolean;
  satisfaction_globale: string;
  satisfaction_trend: string | null;
  satisfaction_trend_positive: boolean;
  total_organisations: number;
  organisations_trend: string | null;
  organisations_trend_positive: boolean;
  total_cx_managers: number;
  cx_managers_trend: string | null;
  cx_managers_trend_positive: boolean;
  total_alertes: number;
  alertes_trend: string | null;
  alertes_trend_positive: boolean;
  activity_7d: ActivityPoint[];
  activity_30d: ActivityPoint[];
  activity_90d: ActivityPoint[];
  organisations_overview: AdminOrganisationHierarchy[];
}

// ── Statistiques & Analyses Spécifiques ────────────────
export interface StatKPI {
  valeur: string | number;
  valeur_num: number;
  valeur_precedente?: number | null;
  evolution?: string | null;
  is_positive: boolean;
  periode_comparaison?: string;
  sous_titre?: string | null;
}

export interface EvolutionPoint {
  date: string;
  label: string;
  feedbacks: number;
  traites: number;
  satisfaction: number;
  positifs: number;
  neutres: number;
  negatifs: number;
}

export interface ThemeStatsDetail {
  theme: string;
  label: string;
  count: number;
  pourcentage: number;
  sentiment_predominant: string;
}

export interface AgenceRankDetail {
  agence_id: string;
  agence_nom: string;
  ville?: string | null;
  satisfaction_rate: number;
  total_feedbacks: number;
  feedbacks_traites: number;
  taux_traitement: number;
  alertes_critiques: number;
  tendance_val?: string | null;
  tendance_positive: boolean;
}

export interface AgenceImpacteeItem {
  agence_id: string;
  agence_nom: string;
  ville?: string | null;
  alertes_count: number;
  satisfaction_rate: number;
}

export interface AlerteSyntheseDetail {
  total_critiques: number;
  agences_impactees: AgenceImpacteeItem[];
  evolution_pct?: string | null;
  evolution_positive: boolean;
}

export interface InsightIADetail {
  id: string;
  type: 'point_fort' | 'recommandation' | 'point_vigilance' | 'synthese';
  titre: string;
  description: string;
  priorite?: 'low' | 'medium' | 'high' | 'critical';
  agence_nom?: string | null;
  date?: string | null;
}

export interface OrganisationRankDetail {
  organisation_id: string;
  nom: string;
  logo?: string | null;
  secteur?: string | null;
  agences_count: number;
  feedbacks_collectes: number;
  feedbacks_traites: number;
  taux_traitement: number;
  satisfaction_globale: number;
  alertes_critiques: number;
  tendance_val?: string | null;
  tendance_positive: boolean;
}

export interface StatsCXResponse {
  organisation_id?: string | null;
  organisation_nom?: string | null;
  periode_jours: number;
  periode_label: string;
  agence_filtree_id?: string | null;
  agence_filtree_nom?: string | null;
  kpis: Record<string, StatKPI>;
  evolution_satisfaction: EvolutionPoint[];
  evolution_volume: EvolutionPoint[];
  sentiments: { sentiment: string; count: number; pourcentage: number }[];
  themes: ThemeStatsDetail[];
  agences_ranking: AgenceRankDetail[];
  alertes_synthese: AlerteSyntheseDetail;
  insights_ia: InsightIADetail[];
}

export interface StatsAgenceResponse {
  agence_id: string;
  agence_nom: string;
  ville?: string | null;
  organisation_nom?: string | null;
  periode_jours: number;
  periode_label: string;
  kpis: Record<string, StatKPI>;
  evolution_satisfaction: EvolutionPoint[];
  evolution_volume: EvolutionPoint[];
  sentiments: { sentiment: string; count: number; pourcentage: number }[];
  themes: ThemeStatsDetail[];
  alertes_synthese: AlerteSyntheseDetail;
  insights_ia: InsightIADetail[];
}

export interface StatsAdminResponse {
  periode_jours: number;
  periode_label: string;
  kpis: Record<string, StatKPI>;
  evolution_volume: EvolutionPoint[];
  evolution_traitement: EvolutionPoint[];
  organisations_ranking: OrganisationRankDetail[];
  activite_plateforme: Record<string, any>;
  utilisation_ia: Record<string, any>;
}


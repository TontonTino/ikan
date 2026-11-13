/**
 * Vocabulaire produit d'IKAN AI — source unique des libellés visibles réutilisés.
 *
 * Règle : les noms techniques (types, champs API, routes, codes KPI) restent tels quels
 * dans le code ; seul le texte affiché à l'utilisateur passe par ce fichier.
 *
 * Un seul nom par notion, partout, titres de page et menus compris (lot 4) :
 *  - Avis client          : ce que le client exprime (entité Feedback).
 *  - Avis à traiter       : LA file d'avis qui demandent un geste (lot 3). Remplace « À surveiller », « Avis à risque »,
 *                           « Notifications » quand il s'agit d'avis.
 *  - Alerte               : agence sous son seuil de satisfaction (page Alertes) ; ni un avis, ni un problème.
 *  - Problème à traiter   : situation que l'organisation décide de suivre (entité Issue),
 *                           créée et regroupée par un humain — aucun regroupement automatique.
 *  - Action               : intervention prévue ou effectuée pour traiter un problème (ActionCorrective) ; créée ≠ terminée.
 *                           Une suggestion de YAM est une « action suggérée » : à valider, jamais exécutée.
 *  - Urgence              : trois niveaux affichés (critique, élevée, normale). Remplace « gravité », « criticité »,
 *                           « priorité ». En base, `criticite` / `severite` gardent leurs quatre valeurs ; « normale »
 *                           regroupe « faible » et « moyenne » à l'affichage et dans les filtres (alias API « normale »).
 *  - Satisfaction         : part des avis notés 4 ou 5, suivie du nombre d'avis et de la fiabilité (lot 3).
 *  - Indicateur           : mesure de pilotage (KPI Engine) ; « aucune donnée » ≠ 0.
 */
import type { CriticiteType, EscaladeMotif, IdeaStatus, IssueStatut, SentimentType, StatutTraitement, UserRole } from '../types';

export const LIBELLES = {
  avis: 'Avis client',
  avisPluriel: 'Avis clients',
  probleme: 'Problème à traiter',
  problemePluriel: 'Problèmes à traiter',
  action: 'Action',
  actionPluriel: 'Actions',
  actionSuggeree: 'Action suggérée',
  actionsSuggerees: 'Actions suggérées',
  avisATraiter: 'Avis à traiter',
  indicateurs: 'Indicateurs',
  tableauDeBord: 'Tableau de bord',
  urgence: 'Urgence',
  sentiment: 'Ton de l’avis',
  avisContradictoire: 'Note et commentaire contradictoires',
  avisContradictoireCourt: 'Avis contradictoire',
  aucuneDonnee: 'Aucune donnée disponible',
  aucuneDonneeCourt: 'Aucune donnée',
  /** Indicateur qui repose sur une saisie que l'interface ne permet pas (encore) : ni zéro ni chiffre, une explication. */
  nonRenseigne: 'Non renseigné',
  chargement: 'Chargement en cours…',
  reessayer: 'Réessayer',
  filtrer: 'Filtrer',
  effacerFiltres: 'Effacer les filtres',
} as const;

/** Nom des rôles affiché à l'utilisateur (codes techniques inchangés : `cx_manager`, `agency_manager`). */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  cx_manager: 'Responsable expérience client',
  agency_manager: 'Responsable d’agence',
};

/**
 * Code de rôle d'un utilisateur tel que renvoyé par l'API. Certaines vues d'administration reçoivent encore le LIBELLÉ
 * historique (« CX Manager », « Agency Manager ») au lieu du code : on ramène les deux au code, pour comparer des codes et
 * jamais des libellés (un renommage de libellé ne doit pas casser un filtre en silence).
 */
const ANCIENS_LIBELLES_ROLE: Record<string, UserRole> = { 'CX Manager': 'cx_manager', 'Agency Manager': 'agency_manager', Admin: 'admin' };
export function codeRole(valeur: string | null | undefined): UserRole | null {
  if (!valeur) return null;
  if (valeur in ROLE_LABELS) return valeur as UserRole;
  return ANCIENS_LIBELLES_ROLE[valeur] ?? null;
}

/** Libellé d'un rôle reçu sous forme de code OU d'ancien libellé ; inconnu : « Rôle non précisé » (jamais la valeur brute). */
export const libelleRole = (valeur: string | null | undefined): string => {
  const code = codeRole(valeur);
  return code ? ROLE_LABELS[code] : 'Rôle non précisé';
};

/** Pluriel des rôles (titres de colonnes, compteurs). */
export const ROLE_LABELS_PLURIEL: Record<UserRole, string> = {
  admin: 'Administrateurs',
  cx_manager: 'Responsables expérience client',
  agency_manager: 'Responsables d’agence',
};

/** Le rôle en milieu de phrase : « votre responsable expérience client ». */
export const roleEnPhrase = (role: UserRole): string => ROLE_LABELS[role].charAt(0).toLowerCase() + ROLE_LABELS[role].slice(1);

/** Responsable expérience client, en milieu de phrase (raccourci de `roleEnPhrase('cx_manager')`). */
export const RESPONSABLE_CX = roleEnPhrase('cx_manager');

/** Urgence (champ technique `criticite` des avis, `severite` des problèmes) : trois niveaux affichés pour quatre valeurs
    en base. « faible » et « moyenne » s'affichent toutes deux « Normale » (filtre : valeur `normale`, voir NIVEAUX_URGENCE). */
export const GRAVITE_LABELS: Record<CriticiteType, string> = {
  faible: 'Normale',
  moyenne: 'Normale',
  elevee: 'Élevée',
  critique: 'Critique',
};
export const URGENCE_LABELS = GRAVITE_LABELS;

/** Les trois niveaux proposés dans les filtres d'urgence, du plus urgent au moins urgent. `normale` est un alias de filtre
    accepté par l'API (= faible ou moyenne), jamais une valeur stockée. */
export const NIVEAUX_URGENCE = [
  { valeur: 'critique', libelle: 'Critique' },
  { valeur: 'elevee', libelle: 'Élevée' },
  { valeur: 'normale', libelle: 'Normale' },
] as const;
export type NiveauUrgence = (typeof NIVEAUX_URGENCE)[number]['valeur'];

/** « Urgence critique », « Urgence normale » ; niveau absent : « Urgence non évaluée ». */
export const libelleUrgence = (niveau: string | null | undefined): string =>
  niveau && niveau in GRAVITE_LABELS ? `Urgence ${GRAVITE_LABELS[niveau as CriticiteType].toLowerCase()}` : 'Urgence non évaluée';

/** Ton de l'avis détecté par l'analyse automatique (champ `sentiment`). */
export const SENTIMENT_LABELS: Record<SentimentType, string> = {
  positif: 'Positif',
  neutre: 'Neutre',
  negatif: 'Négatif',
};

/** Statut de traitement d'un avis client (champ `statut_traitement`). « Pris en charge » :
    le responsable d'agence a pris l'avis en charge par une action explicite (consulter un avis ne suffit pas,
    et une analyse IA n'est jamais une prise en charge) ; « Action en cours » : une action à mener a été définie. */
export const AVIS_STATUT_LABELS: Record<StatutTraitement, string> = {
  nouveau: 'Nouveau',
  en_traitement: 'Pris en charge',
  en_cours: 'Action en cours',
  resolu: 'Résolu',
};

/** Statut d'une action (ActionCorrective) dans les cartes d'action. */
export const ACTION_STATUT_LABELS: Record<'a_faire' | 'en_cours' | 'terminee', string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  terminee: 'Terminée',
};

/** Segments de la page Actions, et mot de fin d'une action selon qu'elle vient d'un problème ou d'un avis. */
export const ACTIONS_SEGMENTS = { enCours: 'En cours', terminees: 'Terminées' } as const;
export const ACTION_FIN_LABELS = { probleme: 'Terminée', avis: 'Réalisée' } as const;

/** Les quatre étapes affichées du cycle d'un problème (frise de la fiche problème). */
export const PROBLEME_ETAPES = ['Enregistré', 'Actions en cours', 'Résolu', 'Résolution vérifiée'] as const;

/** Statut d'une suggestion (idée remontée par un client ou une agence, champ `statut`). */
export const SUGGESTION_STATUT_LABELS: Record<IdeaStatus, string> = {
  nouveau: 'Nouveau',
  en_cours: 'En cours',
  traite: 'Traité',
  rejete: 'Rejeté',
};

/** Statut d'un problème à traiter (Issue). « Résolue » ≠ amélioration démontrée : seule
    « Résolution vérifiée » atteste un contrôle après résolution. */
export const PROBLEME_STATUT_LABELS: Record<IssueStatut, string> = {
  ouverte: 'À traiter',
  action_en_cours: 'Action en cours',
  resolue: 'Résolu',
  verifiee: 'Résolution vérifiée',
  reouverte: 'Rouvert',
};

/** Motif d'une escalade (champ `motif` du journal d'escalade). */
export const ESCALADE_MOTIF_LABELS: Record<EscaladeMotif, string> = {
  sla: 'Délai de traitement dépassé',
  criticite: 'Urgence élevée',
  risque_client: 'Risque de perte du client',
  decision_manageriale: 'Décision de la direction',
  autre: 'Autre motif',
};

export function libelleMotifEscalade(motif: string | null | undefined): string {
  return (motif && (ESCALADE_MOTIF_LABELS as Record<string, string>)[motif]) || 'Motif non précisé';
}

/** Type d'événement du fil d'activité d'une agence (champ `type_evenement`, historique des
    avis). Un type inconnu n'est jamais affiché tel quel. */
const EVENEMENT_AGENCE_LABELS: Record<string, string> = {
  soumission: 'Avis reçu',
  ouverture: 'Avis pris en charge',
  prise_en_charge: 'Avis pris en charge',
  note_interne: 'Note interne ajoutée',
  suggestion_envoyee: 'Suggestion envoyée au siège',
  suggestion_nouveau: 'Suggestion : nouvelle',
  suggestion_en_cours: 'Suggestion : en cours d’examen',
  suggestion_traite: 'Suggestion : traitée',
  suggestion_rejete: 'Suggestion : rejetée',
  action_definie: 'Action définie',
  action_realisee: 'Action réalisée',
  reponse_client: 'Réponse envoyée au client',
  demande_recontactee: 'Client recontacté',
  reouverture: 'Avis rouvert',
  recommandation_traitee: 'Action suggérée traitée',
  recommandation_rouverte: 'Action suggérée remise à traiter',
};

export function libelleEvenementAgence(code: string | null | undefined): string {
  return (code && EVENEMENT_AGENCE_LABELS[code]) || 'Autre événement';
}

/** Motif pour lequel un avis est signalé « à examiner » (GET /alertes, champ `raison`). */
const ALERTE_RAISON_LABELS: Record<string, string> = {
  note_basse: 'note basse',
  sentiment_negatif: 'ton négatif',
  note_basse_et_sentiment_negatif: 'note basse et ton négatif',
};

export function libelleRaisonAlerte(code: string | null | undefined): string {
  return (code && ALERTE_RAISON_LABELS[code]) || 'à examiner';
}

/**
 * Libellés et aides des indicateurs (KPI Engine). Le libellé envoyé par l'API reste la
 * référence ; ce tableau fournit l'explication courte affichée en infobulle, rédigée à
 * partir des définitions de app/services/kpi/definitions.py (aucun calcul inventé).
 */
export const INDICATEUR_AIDE: Record<string, string> = {
  CSAT: 'Part des avis notés 4 ou 5 sur 5, parmi tous les avis reçus sur la période.',
  NEGATIVE_SENTIMENT_RATE:
    'Part des avis dont le ton a été détecté comme négatif par l’analyse automatique. Les avis pas encore analysés ne sont pas comptés.',
  FEEDBACK_VOLUME: 'Nombre d’avis clients reçus sur la période.',
  ISSUE_VOLUME:
    'Nombre de problèmes à traiter enregistrés sur la période. Un problème qui regroupe plusieurs avis compte une seule fois.',
  CRITICAL_ISSUE_RATE: 'Part des problèmes enregistrés sur la période dont l’urgence est « Critique ».',
  ISSUE_RESOLUTION_RATE:
    'Part des problèmes enregistrés sur la période qui sont actuellement résolus. Un problème rouvert n’est plus compté comme résolu.',
  MEDIAN_RESOLUTION_TIME:
    'Durée médiane entre l’enregistrement d’un problème et sa résolution. Les problèmes non résolus ne sont pas comptés.',
  LOOP_CLOSURE_RATE:
    'Parmi les problèmes qui nécessitent une action, part de ceux dont la résolution a été vérifiée.',
  ISSUE_BACKLOG: 'Nombre de problèmes actuellement à traiter, en cours d’action ou rouverts.',
  BACKLOG_AGE: 'Âge médian, en heures, des problèmes encore en attente de résolution.',
  ACTION_COMPLETION_RATE: 'Part des actions créées sur la période (hors actions annulées) qui sont terminées.',
  SLA_COMPLIANCE_RATE:
    'Parmi les problèmes résolus sur la période avec un délai de traitement fixé, part de ceux résolus dans ce délai.',
  ISSUE_RECURRENCE_RATE:
    'Part des problèmes enregistrés sur la période qui ont été explicitement reliés à un problème antérieur.',
  ESCALATION_RATE:
    'Part des problèmes en attente sur la période pour lesquels une intervention supérieure a été demandée.',
  NPS: 'Score de recommandation : % de clients qui notent 9–10 moins % de clients qui notent 0–6, parmi ceux qui ont répondu à la question facultative. Exprimé en points, de −100 à +100.',
  // Pack télécom
  TEL_PART_HORS_PERIMETRE:
    'Part des problèmes classés qui relèvent d’un domaine que l’agence ne peut pas traiter seule (réseau, facturation, mobile money). Ne mesure pas la performance de l’agence.',
  TEL_RECURRENCE_AGENCE:
    'Part de problèmes récurrents, limitée aux domaines gérés par l’agence (accueil, service client, carte SIM, boutique).',
  TEL_RECURRENCE_HORS_PERIMETRE:
    'Part de problèmes récurrents, limitée aux domaines que l’agence ne gère pas seule (réseau, facturation, mobile money).',
  TEL_RECLAMATIONS_RESEAU: 'Part des avis de la période qui sont négatifs et classés « Internet & réseau mobile ».',
  TEL_RECLAMATIONS_RECHARGE_FORFAIT: 'Part des avis de la période qui sont négatifs et classés « Forfaits & recharge ».',
  TEL_RECLAMATIONS_FACTURATION: 'Part des avis de la période qui sont négatifs et classés « Facturation & paiement ».',
  // Pack restauration
  RESTO_TAUX_TRAITEMENT_RECONTACTS:
    'Part des demandes de rappel marquées comme traitées. Le marquage est déclaratif : il ne prouve pas qu’un appel a eu lieu.',
  RESTO_RISQUE_SILENCIEUX:
    'Part des avis négatifs laissés sans moyen de recontacter le client.',
  RESTO_RECIDIVE_CATEGORIE:
    'Parmi les problèmes résolus, part de ceux qui se sont reproduits ensuite (un nouveau problème leur a été relié).',
};

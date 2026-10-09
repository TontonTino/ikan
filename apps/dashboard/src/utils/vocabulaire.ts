/**
 * Vocabulaire produit d'IKAN AI — source unique des libellés visibles réutilisés.
 *
 * Règle : les noms techniques (types, champs API, routes, codes KPI) restent tels quels
 * dans le code ; seul le texte affiché à l'utilisateur passe par ce fichier.
 *
 * Distinctions métier à ne jamais fusionner :
 *  - Avis client          : ce que le client exprime (entité Feedback).
 *  - Problème à traiter   : situation que l'organisation décide de suivre (entité Issue),
 *                           créée et regroupée par un humain — aucun regroupement automatique.
 *  - Action à mener       : intervention prévue ou effectuée pour traiter un problème
 *                           (ActionCorrective) ; créée ≠ terminée.
 *  - Indicateur           : mesure de pilotage (KPI Engine) ; « aucune donnée » ≠ 0.
 *  - Alerte               : signal calculé (seuil, avis à risque) ; n'est pas un problème.
 *  - Recommandation       : suggestion ; n'est pas une décision exécutée.
 */
import type { CriticiteType, IssueStatut, SentimentType, StatutTraitement, UserRole } from '../types';

export const LIBELLES = {
  avis: 'Avis client',
  avisPluriel: 'Avis clients',
  probleme: 'Problème à traiter',
  problemePluriel: 'Problèmes à traiter',
  action: 'Action à mener',
  actionPluriel: 'Actions à mener',
  indicateurs: 'Indicateurs',
  tableauDeBord: 'Tableau de bord',
  gravite: 'Gravité',
  sentiment: 'Ton de l’avis',
  avisContradictoire: 'Note et commentaire contradictoires',
  avisContradictoireCourt: 'Avis contradictoire',
  aucuneDonnee: 'Aucune donnée disponible',
  aucuneDonneeCourt: 'Aucune donnée',
  chargement: 'Chargement en cours…',
  reessayer: 'Réessayer',
  filtrer: 'Filtrer',
  effacerFiltres: 'Effacer les filtres',
} as const;

/** Nom des rôles affiché à l'utilisateur. « CX Manager » est le nom de poste usuel chez
    les clients ; « Agency Manager » est rendu par « Responsable d'agence ». */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  cx_manager: 'CX Manager',
  agency_manager: 'Responsable d’agence',
};

/** Gravité (champ technique `criticite` / `severite`). */
export const GRAVITE_LABELS: Record<CriticiteType, string> = {
  faible: 'Faible',
  moyenne: 'Moyenne',
  elevee: 'Élevée',
  critique: 'Critique',
};

/** Ton de l'avis détecté par l'analyse automatique (champ `sentiment`). */
export const SENTIMENT_LABELS: Record<SentimentType, string> = {
  positif: 'Positif',
  neutre: 'Neutre',
  negatif: 'Négatif',
};

/** Statut de traitement d'un avis client (champ `statut_traitement`). « Pris en charge » :
    l'avis a été ouvert par le responsable d'agence ; « Action en cours » : une action à
    mener a été définie. */
export const AVIS_STATUT_LABELS: Record<StatutTraitement, string> = {
  nouveau: 'Nouveau',
  en_traitement: 'Pris en charge',
  en_cours: 'Action en cours',
  resolu: 'Résolu',
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
  CRITICAL_ISSUE_RATE: 'Part des problèmes enregistrés sur la période dont la gravité est « Critique ».',
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

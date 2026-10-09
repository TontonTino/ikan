import type { CriticiteType, IssueStatut, SentimentType, StatutTraitement } from '../types';

/** Libellés d’interface pour les enums conservés tels quels dans l’API. */
export const SENTIMENT_LABELS: Record<SentimentType, string> = {
  positif: 'Positif',
  neutre: 'Neutre',
  negatif: 'Négatif',
};

export const GRAVITE_LABELS: Record<CriticiteType, string> = {
  faible: 'Faible',
  moyenne: 'Moyenne',
  elevee: 'Élevée',
  critique: 'Critique',
};

export const AVIS_STATUT_LABELS: Record<StatutTraitement, string> = {
  nouveau: 'Nouveau',
  en_traitement: 'En traitement',
  en_cours: 'En cours',
  resolu: 'Résolu',
};

export const PROBLEME_STATUT_LABELS: Record<IssueStatut, string> = {
  ouverte: 'Ouvert',
  action_en_cours: 'Action en cours',
  resolue: 'Résolu',
  verifiee: 'Vérifié',
  reouverte: 'Réouvert',
};

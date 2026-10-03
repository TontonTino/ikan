import type { IdeaStatus, IssueStatut, CriticiteType } from '../../types';

export const ISSUE_STATUT_LABELS: Record<IssueStatut, string> = {
  ouverte: 'Ouverte',
  action_en_cours: 'Action en cours',
  resolue: 'Résolue',
  verifiee: 'Vérifiée',
  reouverte: 'Réouverte',
};

export const ISSUE_STATUT_BADGE_VARIANT: Record<IssueStatut, 'info' | 'elevee' | 'positif'> = {
  ouverte: 'info',
  action_en_cours: 'elevee',
  resolue: 'positif',
  verifiee: 'positif',
  reouverte: 'elevee',
};

export const ISSUE_SEVERITE_LABELS: Record<CriticiteType, string> = {
  faible: 'Faible',
  moyenne: 'Moyenne',
  elevee: 'Élevée',
  critique: 'Critique',
};

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  nouveau: 'Nouveau',
  en_cours: 'En cours',
  traite: 'Traité',
  rejete: 'Rejeté',
};

export const STATUS_STYLE: Record<IdeaStatus, { bg: string; text: string; border: string }> = {
  nouveau: { bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD' },
  en_cours: { bg: '#FEF3C7', text: '#B45309', border: '#FDE68A' },
  traite: { bg: '#EBF5E9', text: '#3C7730', border: '#D5E8D3' },
  rejete: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
};

export const NEXT_STATUS: Record<IdeaStatus, IdeaStatus | null> = {
  nouveau: 'en_cours',
  en_cours: 'traite',
  traite: null,
  rejete: null,
};

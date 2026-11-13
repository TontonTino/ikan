import type { IdeaStatus, IssueStatut, CriticiteType } from '../../types';
import { GRAVITE_LABELS, PROBLEME_STATUT_LABELS } from '../../utils/vocabulaire';

export const ISSUE_STATUT_LABELS: Record<IssueStatut, string> = PROBLEME_STATUT_LABELS;

export const ISSUE_STATUT_BADGE_VARIANT: Record<IssueStatut, 'info' | 'elevee' | 'positif'> = {
  ouverte: 'info',
  action_en_cours: 'elevee',
  resolue: 'positif',
  verifiee: 'positif',
  reouverte: 'elevee',
};

export const ISSUE_SEVERITE_LABELS: Record<CriticiteType, string> = GRAVITE_LABELS;

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  nouveau: 'Nouveau',
  en_cours: 'En cours',
  traite: 'Traité',
  rejete: 'Rejeté',
};

export const STATUS_STYLE: Record<IdeaStatus, { bg: string; text: string; border: string }> = {
  nouveau: { bg: 'var(--color-neutre-fond)', text: 'var(--color-neutre-texte)', border: 'var(--color-neutre-fond)' },
  en_cours: { bg: 'var(--color-surveiller-fond)', text: 'var(--color-surveiller-texte)', border: 'var(--color-surveiller-fond)' },
  traite: { bg: 'var(--color-bon-fond)', text: 'var(--color-bon-texte)', border: 'var(--color-bon-fond)' },
  rejete: { bg: 'var(--color-critique-fond)', text: 'var(--color-critique-texte)', border: 'var(--color-critique-fond)' },
};

export const NEXT_STATUS: Record<IdeaStatus, IdeaStatus | null> = {
  nouveau: 'en_cours',
  en_cours: 'traite',
  traite: null,
  rejete: null,
};

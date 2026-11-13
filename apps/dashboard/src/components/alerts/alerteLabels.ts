import type { StatutTraitement } from '../../types';
import { AVIS_STATUT_LABELS } from '../../utils/vocabulaire';
import { LIBELLES } from '../../utils/vocabulaire';

/** Libellés et ancres partagés entre la page Alertes et la cloche de notifications. */

/**
 * Valeurs réelles de AlerteFeedback.raison renvoyées par GET /alertes
 * (_raison_alerte_feedback, apps/api/.../alertes.py).
 */
export const RAISON_LABELS: Record<string, string> = {
  note_basse: 'Note basse',
  sentiment_negatif: 'Ton négatif',
  note_basse_et_sentiment_negatif: 'Note basse et ton négatif',
};

/** Libellé d'une raison ; une valeur inconnue reste lisible plutôt qu'une clé technique. */
export const raisonLabel = (raison: string) => RAISON_LABELS[raison] ?? LIBELLES.avisATraiter;

/**
 * Statut de traitement d'un avis à risque (AlerteFeedback.statut_traitement), tel qu'en base. Les libellés sont ceux de l'application entière
 * (AVIS_STATUT_LABELS, utils/vocabulaire.ts : une seule table). Seuls les statuts qui signifient « pris en charge » sont mentionnés ici :
 * « nouveau » n'affiche rien (l'absence de mention veut dire « pas encore pris en charge »), « resolu » n'arrive pas dans cette liste, et toute
 * autre valeur (héritée, vide, absente) ne montre rien : jamais de valeur brute à l'écran.
 */
const STATUTS_AVIS_MENTIONNES: readonly StatutTraitement[] = ['en_traitement', 'en_cours'];

export function libelleStatutAvis(statut: string | null | undefined): string | null {
  return statut && (STATUTS_AVIS_MENTIONNES as readonly string[]).includes(statut) ? AVIS_STATUT_LABELS[statut as StatutTraitement] : null;
}

/** Vrai si l'avis a été pris en charge (« Pris en charge » ou « Action en cours » : une action ne se définit que sur un avis déjà pris en charge). */
export const estAvisPrisEnCharge = (statut: string | null | undefined): boolean => libelleStatutAvis(statut) !== null;

/** Ancres stables : la cloche pointe directement sur une alerte de la page /alertes. */
export const alerteSeuilAnchor = (agenceId: string) => `alerte-seuil-${agenceId}`;
export const alerteFeedbackAnchor = (feedbackId: string) => `alerte-feedback-${feedbackId}`;

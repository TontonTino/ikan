/** Libellés et ancres partagés entre la page Alertes et la cloche de notifications. */

/**
 * Valeurs réelles de AlerteFeedback.raison renvoyées par GET /alertes
 * (_raison_alerte_feedback, apps/api/.../alertes.py).
 */
export const RAISON_LABELS: Record<string, string> = {
  note_basse: 'Note basse',
  sentiment_negatif: 'Sentiment négatif',
  note_basse_et_sentiment_negatif: 'Note basse et sentiment négatif',
};

/** Libellé d'une raison ; une valeur inconnue reste lisible plutôt qu'une clé technique. */
export const raisonLabel = (raison: string) => RAISON_LABELS[raison] ?? 'Feedback à risque';

/** Ancres stables : la cloche pointe directement sur une alerte de la page /alertes. */
export const alerteSeuilAnchor = (agenceId: string) => `alerte-seuil-${agenceId}`;
export const alerteFeedbackAnchor = (feedbackId: string) => `alerte-feedback-${feedbackId}`;

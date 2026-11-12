import type { Feedback } from '../types';

/**
 * File « À traiter » (lot 3) : UNE seule file d'avis qui demandent un geste. La règle est écrite côté serveur
 * (apps/api/app/services/dashboard_helpers.py, `est_a_traiter`) : demande de rappel en attente, ou avis non résolu avec une
 * note de 2 ou moins, un ton négatif ou une gravité élevée ou critique. Le dashboard ne la recalcule jamais : il lit la liste
 * filtrée (`a_traiter=true`), qui alimente l'onglet « À traiter », le lien de la page Alertes et la cloche.
 */

/** Adresse de la file (page Avis, onglet « À traiter »). */
export const LIEN_FILE_A_TRAITER = '/feedbacks?filtre=a-traiter';

/** Un avis précis de la file, ouvert dans sa fenêtre de traitement. */
export const lienAvisDeLaFile = (avisId: string) => `${LIEN_FILE_A_TRAITER}&avis=${encodeURIComponent(avisId)}`;

/** Au-delà, un avis encore « nouveau » est en retard (même valeur que DELAI_PRISE_EN_CHARGE_HEURES côté serveur). */
export const DELAI_PRISE_EN_CHARGE_HEURES = 48;

/** Avis sans prise en charge depuis plus de 48 h : le serveur le place en tête de la file, l'écran le marque d'un trait. */
export function estEnRetard(avis: Pick<Feedback, 'statut_traitement' | 'date_soumission'>, maintenant: Date = new Date()): boolean {
  if ((avis.statut_traitement ?? 'nouveau') !== 'nouveau') return false;
  const soumis = new Date(avis.date_soumission).getTime();
  return Number.isFinite(soumis) && maintenant.getTime() - soumis > DELAI_PRISE_EN_CHARGE_HEURES * 3600 * 1000;
}

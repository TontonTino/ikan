import { formatDistanceStrict, formatDistanceToNowStrict, format } from 'date-fns';
import { fr } from 'date-fns/locale';

/** « il y a 3 h », « il y a 2 j » — horodatage relatif court (notifications, cartes). */
export function relativeTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: fr });
}

/** Au-delà de ce nombre de jours (inclus : 30 jours restent relatifs), une date passe en forme absolue. */
export const LIMITE_DATE_RELATIVE_JOURS = 30;

/**
 * Convention de date des alertes et recommandations : relatif (« il y a 3 jours ») jusqu'à 30 jours inclus, puis date absolue française
 * (« 12 oct. 2026 »). Les données et leur fuseau ne sont pas modifiés ; la date complète reste pour l'infobulle (`fullDate`). Vide si invalide.
 */
export function dateRelativeOuAbsolue(iso: string | Date, maintenant: Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const jours = Math.abs(maintenant.getTime() - d.getTime()) / 86_400_000;
  if (jours > LIMITE_DATE_RELATIVE_JOURS) return shortDate(d);
  // Jusqu'à 30 jours : en jours (jamais « 1 mois ») ; en dessous d'un jour, l'unité la plus naturelle (minutes, heures).
  return formatDistanceStrict(d, maintenant, { addSuffix: true, locale: fr, ...(jours >= 1 ? { unit: 'day' as const, roundingMethod: 'floor' as const } : {}) });
}

/** « 4 oct. 2026 » */
export function shortDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'd MMM yyyy', { locale: fr });
}

/** Date complète pour l'attribut title / dateTime. */
export function fullDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return format(d, "d MMMM yyyy 'à' HH:mm", { locale: fr });
}

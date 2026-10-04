import { formatDistanceToNowStrict, format } from 'date-fns';
import { fr } from 'date-fns/locale';

/** « il y a 3 h », « il y a 2 j » — horodatage relatif court (notifications, cartes). */
export function relativeTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: fr });
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

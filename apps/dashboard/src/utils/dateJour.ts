import { differenceInCalendarDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { LIMITE_DATE_RELATIVE_JOURS } from '../components/ui/format';

/**
 * Dates « au jour » (séries journalières : « 2026-10-12 »). Une date sans heure est lue comme un JOUR du calendrier local : jamais décalée par un fuseau
 * (new Date('2026-10-12') serait minuit UTC, donc la veille chez un utilisateur à l'ouest de Greenwich). Toute autre chaîne est lue par `Date`.
 */
export function lireJour(valeur: string | Date): Date | null {
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  const jour = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  const date = jour ? new Date(Number(jour[1]), Number(jour[2]) - 1, Number(jour[3])) : new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Convention de date du dashboard, à la maille du jour : « Aujourd’hui », « Hier », « il y a 5 jours » jusqu'à 30 jours inclus, puis « 12 oct. 2026 ».
 * Vide si la date est invalide ; une date future s'écrit en absolu (jamais « dans 3 jours » pour une donnée passée).
 */
export function jourRelatifOuAbsolu(valeur: string | Date, maintenant: Date = new Date()): string {
  const date = lireJour(valeur);
  if (!date) return '';
  const jours = differenceInCalendarDays(maintenant, date);
  if (jours < 0) return format(date, 'd MMM yyyy', { locale: fr });
  if (jours === 0) return 'Aujourd’hui';
  if (jours === 1) return 'Hier';
  if (jours <= LIMITE_DATE_RELATIVE_JOURS) return `il y a ${jours} jours`;
  return format(date, 'd MMM yyyy', { locale: fr });
}

/** « 12 octobre 2026 » : la date complète d'un jour, pour l'attribut title (survol). */
export function jourComplet(valeur: string | Date): string {
  const date = lireJour(valeur);
  return date ? format(date, 'd MMMM yyyy', { locale: fr }) : '';
}

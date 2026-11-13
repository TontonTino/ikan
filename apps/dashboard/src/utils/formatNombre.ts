/**
 * Formats français UNIQUES du dashboard : nombres, pourcentages, dates de graphique (« 4 août », jamais « Sem 32 »).
 * Règle de typographie : virgule décimale, espace insécable avant « % » (« 61,1 % »). Tout affichage d'un pourcentage passe par ici
 * (aucun formatage local) ; le formateur de la Vue réseau (`fmt`, `satisfactionTexte`) s'appuie sur ces fonctions.
 */
export const ESPACE_INSECABLE = ' ';
export const VALEUR_ABSENTE = '—';

const estNombre = (valeur: unknown): valeur is number => typeof valeur === 'number' && Number.isFinite(valeur);

/** « 61,1 », « 1 234,5 » : séparateurs français, au plus `decimales` décimales (aucune décimale inutile). Valeur absente ou non finie : « — ». */
export function formaterNombre(valeur: number | null | undefined, decimales = 1): string {
  if (!estNombre(valeur)) return VALEUR_ABSENTE;
  return valeur.toLocaleString('fr-FR', { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
}

/** « 61,1 % » (espace insécable). Valeur absente ou non finie : « — » (jamais « NaN % », « undefined % » ni un 0 inventé). */
export function formaterPourcentage(valeur: number | null | undefined, decimales = 1): string {
  if (!estNombre(valeur)) return VALEUR_ABSENTE;
  return `${formaterNombre(valeur, decimales)}${ESPACE_INSECABLE}%`;
}

/**
 * Valeur d'indicateur renvoyée par l'API (`StatKPI.valeur`, ex. « 61.1% » ou « 0.0% »). Quand elle est un pourcentage et que sa valeur numérique est
 * connue, elle est réécrite au format français (« 61,1 % ») ; toute autre valeur (nombre, texte, durée, absence) est rendue telle quelle.
 */
export function formaterValeurApi<T extends string | number | null | undefined>(valeur: T, valeurNum?: number | null): T | string {
  if (typeof valeur === 'string' && /%\s*$/.test(valeur) && estNombre(valeurNum)) return formaterPourcentage(valeurNum);
  return valeur;
}

/** Mois abrégés du dashboard (ceux d'Intl fr-FR, mois « short ») ; l'API écrit les mêmes (`MOIS_COURTS_FR`). */
export const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;

/** « 4 août », ou « 4 août 2026 » avec l'année. Mois de 1 à 12. */
export function dateCourte(annee: number, mois: number, jour: number, avecAnnee = false): string {
  const texte = `${jour} ${MOIS_COURTS[mois - 1]}`;
  return avecAnnee ? `${texte} ${annee}` : texte;
}

const dateCourteUtc = (d: Date, avecAnnee = false) => dateCourte(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), avecAnnee);

/**
 * Date de graphique (lot 6) : « 2026-08-04 » (ou « 2026-08-04T… ») devient « 4 août » (axe) ou, avec `avecAnnee`, « 4 août 2026 »
 * (infobulle). Jamais de numéro de semaine. Toute autre valeur (libellé déjà lisible) est rendue telle quelle.
 */
export function formaterDateAxe(date: string | number, avecAnnee = false): string {
  const lu = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(String(date));
  if (!lu) return String(date);
  return dateCourte(Number(lu[1]), Number(lu[2]), Number(lu[3]), avecAnnee);
}

/** Lundi (UTC) d'une semaine ISO « AAAA-Www ». */
export function lundiSemaineIso(cle: string): Date | null {
  const lu = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (!lu) return null;
  const lundi = new Date(Date.UTC(Number(lu[1]), 0, 4 + (Number(lu[2]) - 1) * 7));
  lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7));
  return lundi;
}

/** Clé de semaine ISO « AAAA-Www » d'un jour « AAAA-MM-JJ » (l'année ISO : le 29/12/2025 est en 2026-W01). */
export function cleSemaineIso(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number);
  const date = new Date(Date.UTC(a, m - 1, j));
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7)); // jeudi de la même semaine
  const anneeIso = date.getUTCFullYear();
  const lundiSemaine1 = lundiSemaineIso(`${anneeIso}-W01`) as Date;
  const numero = 1 + Math.floor((date.getTime() - lundiSemaine1.getTime()) / (7 * 86_400_000));
  return `${anneeIso}-W${String(numero).padStart(2, '0')}`;
}

/** « Semaine du 3 au 9 août 2026 », « Semaine du 31 août au 6 sept. 2026 », « Semaine du 29 déc. 2025 au 4 janv. 2026 ». */
export function libelleSemaine(lundi: Date): string {
  const dimanche = new Date(lundi);
  dimanche.setUTCDate(dimanche.getUTCDate() + 6);
  const memeAnnee = lundi.getUTCFullYear() === dimanche.getUTCFullYear();
  const debut = memeAnnee && lundi.getUTCMonth() === dimanche.getUTCMonth() ? String(lundi.getUTCDate()) : dateCourteUtc(lundi, !memeAnnee);
  return `Semaine du ${debut} au ${dateCourteUtc(dimanche, true)}`;
}

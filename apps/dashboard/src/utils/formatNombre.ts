/**
 * Formats français UNIQUES du dashboard : nombres, pourcentages, dates d'axe de graphique.
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

/**
 * Date de graphique : « 2026-10-06 » (ou « 2026-10-06T… ») devient « 06/10 » (axe) ou, avec `avecAnnee`, « 06/10/2026 » (infobulle).
 * Toute autre valeur est rendue telle quelle.
 */
export function formaterDateAxe(date: string | number, avecAnnee = false): string {
  const lu = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(String(date));
  if (!lu) return String(date);
  return avecAnnee ? `${lu[3]}/${lu[2]}/${lu[1]}` : `${lu[3]}/${lu[2]}`;
}

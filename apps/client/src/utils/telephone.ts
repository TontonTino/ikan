/**
 * Validation du numéro de téléphone du formulaire client (Burkina Faso : indicatif 226 +
 * 8 chiffres). Même règle que le serveur : apps/api/app/utils/phone.py — les garder alignées.
 * Pour ajouter un pays, ajouter une entrée à PAYS_ACCEPTES.
 */
export interface RegleTelephone {
  indicatif: string;
  longueurLocale: number;
}

export const PAYS_ACCEPTES: readonly RegleTelephone[] = [
  { indicatif: '226', longueurLocale: 8 }, // Burkina Faso
];
const PAYS_PAR_DEFAUT = PAYS_ACCEPTES[0];

export const MESSAGE_TELEPHONE_INVALIDE =
  'Numéro invalide. Saisissez 8 chiffres (ex. 70 12 34 56) ou le format +226 70 12 34 56.';

/** « 22670123456 » (international, sans « + » ni espaces) ou null si vide/invalide. */
export function normaliserTelephone(valeur: string | null | undefined): string | null {
  if (valeur == null) return null;
  let brut = String(valeur).replace(/[\s.\-()]/g, '');
  if (!brut) return null;
  if (brut.startsWith('+')) brut = brut.slice(1);
  else if (brut.startsWith('00')) brut = brut.slice(2);
  if (!/^[0-9]+$/.test(brut)) return null;

  if (brut.length === PAYS_PAR_DEFAUT.longueurLocale) return PAYS_PAR_DEFAUT.indicatif + brut;
  for (const regle of PAYS_ACCEPTES) {
    if (brut.startsWith(regle.indicatif) && brut.length === regle.indicatif.length + regle.longueurLocale) {
      return brut;
    }
  }
  return null;
}

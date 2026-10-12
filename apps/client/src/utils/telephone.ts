/** Validation syntaxique d'un numéro international explicite, sans inférer le pays. */
export const MESSAGE_TELEPHONE_INVALIDE =
  'Numéro de téléphone invalide. Saisissez le numéro avec son indicatif international, par exemple +226 70 12 34 56.';

/** Retourne les chiffres internationaux sans « + », ou null si vide/invalide. */
export function normaliserTelephone(valeur: string | null | undefined): string | null {
  if (valeur == null) return null;
  let brut = String(valeur).replace(/[\s.\-()]/g, '');
  if (!brut) return null;
  if (brut.startsWith('+')) brut = brut.slice(1);
  else if (brut.startsWith('00')) brut = brut.slice(2);
  else return null;
  if (!/^[0-9]{8,15}$/.test(brut) || brut.startsWith('0')) return null;
  return brut;
}

/**
 * Numéro de téléphone du formulaire (lot 5). Le champ affiche un indicatif « +226 » fixe : la plupart des clients tapent
 * leurs 8 chiffres. On accepte donc 8 chiffres (avec ou sans espaces), un numéro déjà écrit avec +226 ou 00226, et tout autre
 * numéro international explicite (+ ou 00). On reconstitue le format international à l'envoi.
 */
export const INDICATIF_BURKINA = '226';
const CHIFFRES_NATIONAUX = 8;

export const MESSAGE_TELEPHONE_INVALIDE =
  'Numéro de téléphone invalide. Saisissez les 8 chiffres de votre numéro, par exemple 70 12 34 56.';

const nettoyer = (valeur: string) => valeur.replace(/[\s.\-()]/g, '');

/** Retourne les chiffres internationaux sans « + » (« 22670123456 »), ou null si vide/invalide. */
export function normaliserTelephone(valeur: string | null | undefined): string | null {
  if (valeur == null) return null;
  let brut = nettoyer(String(valeur));
  if (!brut) return null;
  // 8 chiffres : numéro national, l'indicatif +226 est celui affiché devant le champ.
  if (/^[0-9]{8}$/.test(brut) && !brut.startsWith('00')) return INDICATIF_BURKINA + brut;
  if (brut.startsWith('+')) brut = brut.slice(1);
  else if (brut.startsWith('00')) brut = brut.slice(2);
  else return null;
  if (brut.startsWith(INDICATIF_BURKINA)) return /^226[0-9]{8}$/.test(brut) ? brut : null;
  if (!/^[0-9]{8,15}$/.test(brut) || brut.startsWith('0')) return null;
  return brut;
}

/** Format envoyé à l'API : « +22670123456 », ou null. */
export function telephoneInternational(valeur: string | null | undefined): string | null {
  const chiffres = normaliserTelephone(valeur);
  return chiffres ? `+${chiffres}` : null;
}

/**
 * Affichage pendant la saisie : chiffres groupés par deux (« 70 12 34 56 »), 8 au plus. Un indicatif +226 ou 00226 tapé
 * par le client est retiré (il est déjà affiché devant le champ). Un autre numéro international reste tel quel.
 */
export function formaterSaisieTelephone(valeur: string): string {
  const brut = nettoyer(valeur);
  let national: string;
  if (/^(\+|00)226/.test(brut)) national = brut.replace(/^(\+|00)226/, '');
  else if (/^(\+|00)/.test(brut)) return valeur;
  else national = brut;
  return national.replace(/\D/g, '').slice(0, CHIFFRES_NATIONAUX).replace(/(\d{2})(?=\d)/g, '$1 ');
}

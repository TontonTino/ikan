/**
 * Numéro de téléphone lisible (lot 6) : « +22656465888 » s'affiche « +226 56 46 58 88 », par groupes de deux chiffres.
 * Le pilote est au Burkina Faso (+226, 8 chiffres) : seul ce format est regroupé ; tout autre numéro est rendu tel que saisi,
 * plutôt que regroupé au hasard. Le lien « tel: » garde la forme compacte (`telephoneCompact`).
 */
const groupesDeDeux = (chiffres: string) => chiffres.replace(/(\d{2})(?=\d)/g, '$1 ');

export function telephoneCompact(numero: string): string {
  return numero.replace(/[\s.\-()]/g, '');
}

export function formaterTelephone(numero: string | null | undefined): string {
  if (!numero) return '';
  const compact = telephoneCompact(numero.trim());
  const burkina = /^(?:\+|00)226(\d{8})$/.exec(compact);
  if (burkina) return `+226 ${groupesDeDeux(burkina[1])}`;
  if (/^\d{8}$/.test(compact)) return groupesDeDeux(compact);
  return numero.trim();
}

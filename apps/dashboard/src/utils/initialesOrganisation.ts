/**
 * Initiales d'une organisation pour le repli sans logo (carte de contexte de la barre latérale) : DEUX lettres.
 * - un seul mot (« Orange ») : ses deux premières lettres → « OR » ;
 * - deux mots ou plus (« Orange Bank », « Restaurant Le Prestige ») : la première lettre des deux premiers mots significatifs
 *   (les articles et prépositions « le, la, les, de, du, des, et, d', l' » sont ignorés) → « OB », « RP » ;
 * - nom vide : « O » (repli historique).
 */
const PARTICULES = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'the', 'of', 'and', '&']);

export function initialesOrganisation(nom: string | null | undefined): string {
  const mots = (nom ?? '')
    .normalize('NFC')
    .split(/[\s\-'’]+/)
    .map((m) => m.trim())
    .filter(Boolean);
  const significatifs = mots.filter((m) => !PARTICULES.has(m.toLowerCase()));
  const retenus = significatifs.length > 0 ? significatifs : mots;
  if (retenus.length === 0) return 'O';
  const lettres = (mot: string) => Array.from(mot.replace(/[^\p{L}\p{N}]/gu, ''));
  if (retenus.length === 1) return lettres(retenus[0]).slice(0, 2).join('').toLocaleUpperCase('fr-FR') || 'O';
  const [a, b] = retenus.slice(0, 2).map((m) => lettres(m)[0] ?? '');
  return `${a}${b}`.toLocaleUpperCase('fr-FR') || 'O';
}

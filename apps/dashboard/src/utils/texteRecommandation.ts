/**
 * Texte d'une recommandation tel qu'il est AFFICHÉ. La donnée reste intacte (l'API et la base ne sont pas touchées) : seul le préfixe exact
 * « URGENT — » en tête est omis, car la priorité est déjà portée par le badge « Priorité critique ».
 * Insensible à la casse ; espaces, insécables (U+00A0) et fines insécables (U+202F) acceptés autour du tiret cadratin. Rien d'autre n'est retiré :
 * un « urgent » au milieu du texte, un tiret simple ou un autre mot restent affichés. Si le préfixe était tout le texte, le texte d'origine est conservé.
 */
const PREFIXE_URGENT = /^[\s\u00a0\u202f]*URGENT[\s\u00a0\u202f]*—[\s\u00a0\u202f]*/i;

export function texteRecommandationAffiche(contenu: string): string {
  const sans = contenu.replace(PREFIXE_URGENT, '');
  return sans.trim() === '' ? contenu : sans;
}

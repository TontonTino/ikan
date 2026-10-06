/**
 * Libellés selon l'origine RÉELLE des contenus (champ `source` renvoyé par l'API).
 * « IA » n'est affiché que si au moins un contenu provient réellement d'un LLM
 * ('llm' ou 'hybride') ; un contenu calculé par règles est « automatique ».
 */
import type { SourceAnalyse } from '../types';

export const contientIA = (items: { source?: SourceAnalyse }[]) =>
  items.some((i) => i.source === 'llm' || i.source === 'hybride');

export const libelleRecommandations = (items: { source?: SourceAnalyse }[]) =>
  contientIA(items) ? 'Recommandations IA' : 'Recommandations automatiques';

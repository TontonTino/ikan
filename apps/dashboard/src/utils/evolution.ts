import type { StatKPI } from '../types';

/**
 * Évolution d'un indicateur par rapport à la période précédente de même durée, prête à afficher (AM-02).
 * Le sens est toujours porté par une flèche ET un signe ET une valeur, jamais par la couleur seule.
 *
 *  - indisponible       : l'API ne fournit pas de comparaison (ancien serveur) ou la valeur actuelle n'existe pas : rien à montrer ;
 *  - sans_donnees_avant : la période précédente n'a aucun avis : « Pas de données avant » (jamais 0, NaN ni flèche trompeuse) ;
 *  - evolution          : hausse, baisse ou stable, avec sa valeur signée (« +16,7 pts », « −100,0 % »).
 */
export type EvolutionAffichee =
  | { etat: 'indisponible' }
  | { etat: 'sans_donnees_avant' }
  | { etat: 'evolution'; sens: 'hausse' | 'baisse' | 'stable'; valeur: string; favorable: boolean };

export const TEXTE_SANS_DONNEES_AVANT = 'Pas de données avant';

const FORMAT_EVOLUTION = /^([+\-−])?\s*(\d+(?:[.,]\d+)?)\s*(pts?|%)$/;

const nombreFr = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function presenterEvolution(kpi: StatKPI | null | undefined, nombrePrecedent: number | null | undefined): EvolutionAffichee {
  if (!kpi || kpi.status === 'no_data' || nombrePrecedent == null) return { etat: 'indisponible' };
  if (nombrePrecedent === 0 || kpi.evolution == null) return { etat: 'sans_donnees_avant' };

  const lu = FORMAT_EVOLUTION.exec(kpi.evolution.trim());
  if (!lu) return { etat: 'indisponible' };            // texte inattendu : on n'affiche rien plutôt qu'une valeur douteuse
  const nombre = Number(lu[2].replace(',', '.'));
  if (!Number.isFinite(nombre)) return { etat: 'indisponible' };

  const unite = lu[3].startsWith('pt') ? 'pts' : '%';
  const espace = unite === '%' ? ' ' : ' '; // espace fine insécable avant « % », comme en typographie française
  if (nombre === 0) return { etat: 'evolution', sens: 'stable', valeur: `0,0${espace}${unite} · stable`, favorable: true };

  const negatif = lu[1] === '-' || lu[1] === '−';
  return {
    etat: 'evolution',
    sens: negatif ? 'baisse' : 'hausse',
    valeur: `${negatif ? '−' : '+'}${nombreFr(nombre)}${espace}${unite}`,
    favorable: kpi.is_positive,
  };
}

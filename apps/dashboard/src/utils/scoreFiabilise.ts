/*
 * Classement des agences (lot 3) : le dashboard n'affiche plus qu'UN pourcentage, la satisfaction, suivie du nombre d'avis et
 * d'une mention de fiabilité en un mot. Le classement, lui, reste TRIÉ par l'API selon le « score fiabilisé »
 * (api/app/utils/stats.py::wilson_lower_bound) : la BORNE BASSE de l'intervalle de confiance de Wilson, à 95 %, de la part d'avis
 * notés 4 ou 5. C'est une estimation prudente de la satisfaction : avec peu d'avis elle reste bien en dessous du taux observé
 * (100 % sur 2 avis donne environ 34 %), et elle s'en rapproche quand le nombre d'avis augmente. Ce score n'est plus affiché ;
 * la phrase sous le tableau explique le tri.
 */

/** Seuils de la mention de fiabilité : faible (moins de 10 avis), moyenne (10 à 29), bonne (30 et plus). */
export const SEUILS_FIABILITE = { moyenne: 10, bonne: 30 } as const;

export type NiveauFiabilite = 'faible' | 'moyenne' | 'bonne';

export function niveauFiabilite(nombreAvis: number): NiveauFiabilite {
  if (nombreAvis >= SEUILS_FIABILITE.bonne) return 'bonne';
  if (nombreAvis >= SEUILS_FIABILITE.moyenne) return 'moyenne';
  return 'faible';
}

/** « 12 avis · fiabilité moyenne » : ce qui suit la satisfaction dans le classement. */
export const mentionAvisEtFiabilite = (nombreAvis: number): string =>
  `${nombreAvis.toLocaleString('fr-FR')} avis · fiabilité ${niveauFiabilite(nombreAvis)}`;

/** Phrase sous le classement : comment les agences sont ordonnées, sans afficher le score. */
export const PHRASE_TRI_CLASSEMENT =
  'Ordre du classement : satisfaction corrigée du nombre d’avis (borne basse de l’intervalle de confiance de Wilson à 95 %). ' +
  'Une agence à 100 % sur 2 avis ne passe donc pas devant une agence à 90 % sur 200 avis.';

/*
 * Libellé et aide du score de classement des agences, écrits UNE seule fois (classement des statistiques, blocs « Mieux classées /
 * À améliorer » du siège, sous-titre de l'onglet Agences).
 *
 * Ce que désigne « fiabilisé » dans le code (api/app/utils/stats.py::wilson_lower_bound) : la BORNE BASSE de l'intervalle de confiance
 * de Wilson, à 95 %, de la part d'avis notés 4 ou 5. C'est une estimation prudente de la satisfaction : avec peu d'avis elle reste
 * bien en dessous du taux observé (100 % sur 2 avis donne environ 34 %), et elle s'en rapproche quand le nombre d'avis augmente.
 * Ce n'est pas une mesure de « fiabilité » de l'agence.
 */
export const LIBELLE_SCORE_FIABILISE = 'Score fiabilisé';

export const AIDE_SCORE_FIABILISE =
  'Estimation prudente de la satisfaction : borne basse de l’intervalle de confiance de Wilson à 95 % sur la part d’avis notés 4 ou 5. ' +
  'Avec peu d’avis, elle reste bien en dessous du taux observé ; elle s’en rapproche quand les avis sont nombreux. ' +
  'Une agence à 100 % sur 2 avis ne passe donc pas devant une agence à 90 % sur 200 avis.';

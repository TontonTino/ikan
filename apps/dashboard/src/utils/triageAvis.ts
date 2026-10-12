import type { Feedback } from '../types';

/**
 * Catégories de triage des avis (liste d'avis). Elles restent DISTINCTES : un même avis peut appartenir à
 * plusieurs catégories, et leurs effectifs diffèrent légitimement (ce ne sont pas des synonymes).
 *
 *  - négatif       : note faible (≤ 2) OU ton négatif détecté (mêmes règles que les alertes sur avis) ;
 *  - critique      : criticité IA « élevée » ou « critique » (classification de l'analyse automatique) ;
 *  - discordant    : note et commentaire contradictoires (analyse IA) ;
 *  - à surveiller  : AU MOINS UN des trois critères ci-dessus (union : chaque avis compte UNE seule fois) ;
 *  - à traiter     : statut non résolu, ou demande de rappel pas encore traitée (même règle que l'API).
 * Une alerte est un signal calculé par le serveur (GET /alertes) : elle n'est pas un statut de traitement.
 */

/** Note de 2 ou moins = note faible (règle des alertes sur avis, apps/api/.../alertes.py). */
export const NOTE_FAIBLE_MAX = 2;

export const normalizeSentiment = (sentiment?: string): string => {
  if (!sentiment) return '';
  const s = sentiment.toLowerCase().trim();
  if (s === 'positive') return 'positif';
  if (s === 'negative') return 'negatif';
  if (s === 'neutral') return 'neutre';
  return s;
};

export const normalizeCriticite = (criticite?: string): string => {
  if (!criticite) return '';
  return criticite.toLowerCase().trim();
};

type AvisTriage = Pick<Feedback, 'note' | 'statut_traitement' | 'analyse_ia' | 'demande_contact'>;

export const aNoteFaible = (f: AvisTriage) => f.note <= NOTE_FAIBLE_MAX;

export const estNegatif = (f: AvisTriage) => aNoteFaible(f) || normalizeSentiment(f.analyse_ia?.sentiment) === 'negatif';

export const aCriticiteElevee = (f: AvisTriage) => {
  const c = normalizeCriticite(f.analyse_ia?.criticite);
  return c === 'critique' || c === 'elevee';
};

export const aDiscordance = (f: AvisTriage) => Boolean(f.analyse_ia?.discordance_detectee);

/** Avis à surveiller : au moins un critère de triage (jamais compté plusieurs fois). */
export const aSurveiller = (f: AvisTriage) => estNegatif(f) || aCriticiteElevee(f) || aDiscordance(f);

/** Avis à traiter : non résolu, ou demande de rappel en attente. */
export const aTraiter = (f: AvisTriage) => (f.statut_traitement || 'nouveau') !== 'resolu' || Boolean(f.demande_contact && !f.demande_contact.traitee);

export interface CompteursTriage {
  total: number;
  negatifs: number;
  criticiteElevee: number;
  discordants: number;
  /** Avis UNIQUES correspondant à au moins un critère (≤ somme des trois autres). */
  aSurveiller: number;
  aTraiter: number;
}

export function compterTriage(feedbacks: AvisTriage[]): CompteursTriage {
  return {
    total: feedbacks.length,
    negatifs: feedbacks.filter(estNegatif).length,
    criticiteElevee: feedbacks.filter(aCriticiteElevee).length,
    discordants: feedbacks.filter(aDiscordance).length,
    aSurveiller: feedbacks.filter(aSurveiller).length,
    aTraiter: feedbacks.filter(aTraiter).length,
  };
}

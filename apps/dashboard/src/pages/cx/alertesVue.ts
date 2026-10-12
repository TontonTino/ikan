import type { Alerte, AlerteFeedback } from '../../types';

/**
 * Règles de lecture de la page /alertes. Tout provient du serveur (GET /alertes/) : aucune catégorie d'alerte,
 * aucun statut et aucun score n'est inventé. Les alertes sont recalculées à chaque appel (sans état « lu/traité »).
 */

// ── État d'une source de données ───────────────────────────────────────────────────────────────────
export type EtatSource<T> = {
  statut: 'chargement' | 'pret' | 'erreur';
  donnees: T;
  /** Au moins un chargement a réussi : un échec ultérieur conserve alors les données et le signale. */
  charge: boolean;
};

export type ActionSource<T> = { type: 'debut' } | { type: 'succes'; donnees: T } | { type: 'echec' };

export const sourceInitiale = <T,>(vide: T): EtatSource<T> => ({ statut: 'chargement', donnees: vide, charge: false });

export function sourceReducer<T>(state: EtatSource<T>, action: ActionSource<T>): EtatSource<T> {
  switch (action.type) {
    case 'debut':
      return { ...state, statut: 'chargement' };
    case 'succes':
      return { statut: 'pret', donnees: action.donnees, charge: true };
    case 'echec':
      // Les données déjà chargées restent affichées ; sans donnée, l'écran affiche une erreur (jamais « aucune alerte »).
      return { ...state, statut: 'erreur' };
    default:
      return state;
  }
}

// ── Alertes ────────────────────────────────────────────────────────────────────────────────────────
export type TypeAlerte = 'toutes' | 'seuil' | 'avis';
export type TonAlerte = 'critical' | 'warning';

/** Règle existante (cf. vue d'ensemble de l'agence) : une note de 2 ou moins est critique. */
export const NOTE_CRITIQUE_MAX = 2;
/** Alertes sur avis affichées d'emblée ; les suivantes se déplient. */
export const AVIS_VISIBLES = 10;

export const tonAvis = (note: number): TonAlerte => (note <= NOTE_CRITIQUE_MAX ? 'critical' : 'warning');

/** Critiques d'abord, puis du plus récent au plus ancien (ordre déjà fourni par l'API). */
export function trierAvis(avis: AlerteFeedback[]): AlerteFeedback[] {
  return [...avis].sort((a, b) => {
    const ta = tonAvis(a.note) === 'critical' ? 0 : 1;
    const tb = tonAvis(b.note) === 'critical' ? 0 : 1;
    return ta - tb || new Date(b.date_soumission).getTime() - new Date(a.date_soumission).getTime();
  });
}

export interface AlertesFiltrees {
  seuil: Alerte[];
  avis: AlerteFeedback[];
}

export function filtrerAlertes(entrees: { seuil: Alerte[]; avis: AlerteFeedback[]; type: TypeAlerte; agenceId: string | null }): AlertesFiltrees {
  const { seuil, avis, type, agenceId } = entrees;
  return {
    seuil: type === 'avis' ? [] : seuil.filter((a) => !agenceId || a.agence_id === agenceId),
    avis: type === 'seuil' ? [] : trierAvis(avis.filter((a) => !agenceId || a.agence_id === agenceId)),
  };
}

export function compterAlertes(seuil: Alerte[], avis: AlerteFeedback[], agenceId: string | null) {
  const s = seuil.filter((a) => !agenceId || a.agence_id === agenceId).length;
  const a = avis.filter((x) => !agenceId || x.agence_id === agenceId);
  return { seuil: s, avis: a.length, critiques: a.filter((x) => tonAvis(x.note) === 'critical').length, total: s + a.length };
}

const PREFIXE_ANCRE_AVIS = 'alerte-feedback-';

/** Identifiant de l'avis ciblé par l'ancre de la cloche (#alerte-feedback-…), ou null. */
export function avisCible(hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return id.startsWith(PREFIXE_ANCRE_AVIS) ? id.slice(PREFIXE_ANCRE_AVIS.length) : null;
}

/**
 * Nombre d'alertes sur avis à afficher. Si l'alerte ciblée par la cloche est au-delà de la limite,
 * toute la liste est affichée : une alerte ne doit jamais rester introuvable derrière « Afficher la suite ».
 */
export function nombreAvisVisibles(avis: AlerteFeedback[], depliee: boolean, cibleId: string | null, limite = AVIS_VISIBLES): number {
  if (depliee || avis.length <= limite) return avis.length;
  const index = cibleId ? avis.findIndex((a) => a.feedback_id === cibleId) : -1;
  return index >= limite ? avis.length : limite;
}

/** Message de forfait : explicite, jamais confondu avec « aucune alerte ». */
export function messageForfait(nomForfait: string | null, cx: boolean): { titre: string; detail: string } {
  return {
    titre: nomForfait ? `Les alertes de satisfaction ne sont pas incluses dans le forfait ${nomForfait}` : 'Les alertes de satisfaction ne sont pas incluses dans le forfait de votre organisation',
    detail: cx
      ? 'Cette liste est vide parce que la fonctionnalité n’est pas disponible, pas parce que la satisfaction du réseau est bonne.'
      : 'Cette liste est vide parce que la fonctionnalité n’est pas disponible, pas parce que la satisfaction de votre agence est bonne. Rapprochez-vous de votre CX Manager pour faire évoluer le forfait.',
  };
}

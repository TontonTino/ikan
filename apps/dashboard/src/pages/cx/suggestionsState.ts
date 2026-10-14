import type { IdeaStatus, Suggestion } from '../../types';

/**
 * État de la liste des suggestions : « chargement », « prêt » (liste éventuellement vide) ou « erreur ».
 * Règle : un échec ne vaut JAMAIS « liste vide » et n'efface pas les données déjà chargées.
 */
export type SuggestionsState = {
  statut: 'chargement' | 'pret' | 'erreur';
  donnees: Suggestion[];
  total: number;
};

export type SuggestionsAction =
  | { type: 'debut' }
  | { type: 'succes'; donnees: Suggestion[]; total: number }
  | { type: 'echec' }
  | { type: 'plus'; donnees: Suggestion[] }
  | { type: 'statut'; id: string; statut: IdeaStatus }
  /** Remplace une suggestion par la version renvoyée par le serveur (statut, dernier changement, date de traitement). */
  | { type: 'maj'; suggestion: Suggestion };

export const SUGGESTIONS_INITIAL: SuggestionsState = { statut: 'chargement', donnees: [], total: 0 };

export function suggestionsReducer(state: SuggestionsState, action: SuggestionsAction): SuggestionsState {
  switch (action.type) {
    case 'debut':
      return { ...state, statut: 'chargement' };
    case 'succes':
      return { statut: 'pret', donnees: action.donnees, total: action.total };
    case 'echec':
      // Les données déjà chargées restent à l'écran ; seule la liste vide devient un état d'erreur.
      return { ...state, statut: 'erreur' };
    case 'plus': {
      // Une suggestion arrivée entre-temps décale les positions : on écarte les doublons.
      const connus = new Set(state.donnees.map((s) => s.id));
      return { ...state, donnees: [...state.donnees, ...action.donnees.filter((s) => !connus.has(s.id))] };
    }
    case 'statut':
      return { ...state, donnees: state.donnees.map((s) => (s.id === action.id ? { ...s, statut: action.statut } : s)) };
    case 'maj':
      return { ...state, donnees: state.donnees.map((s) => (s.id === action.suggestion.id ? { ...s, ...action.suggestion } : s)) };
    default:
      return state;
  }
}

/** Total annoncé par le serveur (X-Total-Count), à défaut le nombre de lignes reçues. */
export function totalAnnonce(headers: Record<string, unknown> | undefined, lignes: number): number {
  const brut = Number(headers?.['x-total-count']);
  return Number.isFinite(brut) ? brut : lignes;
}

export const SUGGESTIONS_PAGE = 50;

/** Paramètres de GET /suggestions/ : l'agence du contexte est transmise au serveur, jamais filtrée côté navigateur. */
export function parametresSuggestions(agenceId: string | undefined, offset: number) {
  return { limit: SUGGESTIONS_PAGE, offset, ...(agenceId ? { agence_id: agenceId } : {}) };
}

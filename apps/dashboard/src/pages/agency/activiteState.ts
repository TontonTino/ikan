import type { ActiviteAgenceItem } from '../../types';

/**
 * Fil d'activité d'une agence : « chargement », « prêt » (liste éventuellement vide) ou « erreur ».
 * Même règle que les suggestions : un échec n'est JAMAIS une liste vide et n'efface pas les données déjà chargées.
 */
export type ActiviteState = {
  statut: 'chargement' | 'pret' | 'erreur';
  evenements: ActiviteAgenceItem[];
};

export type ActiviteAction = { type: 'debut' } | { type: 'succes'; evenements: ActiviteAgenceItem[] } | { type: 'echec' };

export const ACTIVITE_INITIALE: ActiviteState = { statut: 'chargement', evenements: [] };

export function activiteReducer(state: ActiviteState, action: ActiviteAction): ActiviteState {
  switch (action.type) {
    case 'debut':
      return { ...state, statut: 'chargement' };
    case 'succes':
      return { statut: 'pret', evenements: action.evenements };
    case 'echec':
      return { ...state, statut: 'erreur' };
    default:
      return state;
  }
}

import type { HistoriqueSuggestion, IdeaStatus } from '../../types';
import { ROLE_LABELS } from '../../utils/vocabulaire';
import { STATUS_LABELS } from './pilotageConstants';

/** Longueur maximale du commentaire d'un changement de statut (même valeur que l'API : SuggestionStatusUpdate). */
export const LONGUEUR_MAX_COMMENTAIRE = 500;

export type ResultatChangement = { ok: true } | { ok: false; message: string };

export const MESSAGE_ECHEC_GENERIQUE = 'Impossible d’enregistrer la modification. Réessayez.';

const dateLongue = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
export const dateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const nomAuteur = (entree: Pick<HistoriqueSuggestion, 'auteur_nom'>) => entree.auteur_nom || 'auteur inconnu';
export const libelleRole = (role: string | null | undefined) => (role && role in ROLE_LABELS ? ROLE_LABELS[role as keyof typeof ROLE_LABELS] : null);

/** « Traité par Awa Traoré, le 13 octobre 2026 » : le dernier changement affiché sur la carte. */
export function libelleDernierChangement(entree: HistoriqueSuggestion): string {
  return `${STATUS_LABELS[entree.nouveau_statut]} par ${nomAuteur(entree)}, le ${dateLongue(entree.date)}`;
}

/** « Nouveau → En cours » pour une ligne d'historique. */
export function libelleTransition(entree: Pick<HistoriqueSuggestion, 'ancien_statut' | 'nouveau_statut'>): string {
  const depuis = entree.ancien_statut ? STATUS_LABELS[entree.ancien_statut] : 'Création';
  return `${depuis} → ${STATUS_LABELS[entree.nouveau_statut]}`;
}

/** Compteur du champ commentaire : « 123 / 500 ». */
export const compteurCommentaire = (texte: string) => `${texte.length} / ${LONGUEUR_MAX_COMMENTAIRE}`;

export interface ActionStatut { cible: IdeaStatus; libelle: string; }

/**
 * Changements de statut proposés selon le statut actuel. L'API n'interdit que le retour à « Nouveau » : tout le reste est proposé,
 * y compris rouvrir une suggestion traitée ou rejetée (vers « En cours »).
 */
export function actionsPossibles(statut: IdeaStatus): ActionStatut[] {
  const rouvrir: ActionStatut = { cible: 'en_cours', libelle: 'Rouvrir (En cours)' };
  switch (statut) {
    case 'nouveau': return [{ cible: 'en_cours', libelle: 'Passer à « En cours »' }, { cible: 'rejete', libelle: 'Rejeter' }];
    case 'en_cours': return [{ cible: 'traite', libelle: 'Passer à « Traité »' }, { cible: 'rejete', libelle: 'Rejeter' }];
    case 'traite': return [rouvrir, { cible: 'rejete', libelle: 'Rejeter' }];
    case 'rejete': return [rouvrir];
    default: return [];
  }
}

/** Message clair pour l'utilisateur à partir d'une erreur de l'API (jamais de détail technique). */
export function messageErreurChangement(erreur: unknown): string {
  const reponse = (erreur as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  const detail = typeof reponse?.data?.detail === 'string' ? reponse.data.detail : null;
  switch (reponse?.status) {
    case 409: return detail || 'Ce changement de statut n’est pas possible pour cette suggestion.';
    case 422: return `Le commentaire n’est pas valide : ${LONGUEUR_MAX_COMMENTAIRE} caractères au plus, sans caractères spéciaux.`;
    case 403: return 'Vous n’avez pas accès à cette suggestion.';
    case 404: return 'Cette suggestion n’existe plus. Actualisez la liste.';
    default: return MESSAGE_ECHEC_GENERIQUE;
  }
}

// ── État du formulaire de changement de statut d'UNE carte ──────────────────────────────────────

export interface EtatChangement {
  /** Statut visé ; null = formulaire fermé. */
  cible: IdeaStatus | null;
  commentaire: string;
  envoi: boolean;
  erreur: string | null;
}

export const CHANGEMENT_FERME: EtatChangement = { cible: null, commentaire: '', envoi: false, erreur: null };

export type ActionChangement =
  | { type: 'ouvrir'; cible: IdeaStatus }
  | { type: 'saisir'; commentaire: string }
  | { type: 'envoyer' }
  | { type: 'echec'; message: string }
  | { type: 'succes' }
  | { type: 'annuler' };

/** Un refus (409…) garde la saisie et le formulaire ouverts : l'utilisateur corrige sans retaper son commentaire. */
export function changementReducer(etat: EtatChangement, action: ActionChangement): EtatChangement {
  switch (action.type) {
    case 'ouvrir': return { cible: action.cible, commentaire: etat.cible === action.cible ? etat.commentaire : '', envoi: false, erreur: null };
    case 'saisir': return { ...etat, commentaire: action.commentaire.slice(0, LONGUEUR_MAX_COMMENTAIRE), erreur: null };
    case 'envoyer': return { ...etat, envoi: true, erreur: null };
    case 'echec': return { ...etat, envoi: false, erreur: action.message };
    case 'succes':
    case 'annuler': return CHANGEMENT_FERME;
    default: return etat;
  }
}

/** Commentaire à envoyer : espaces retirés, absent s'il est vide. */
export const commentaireAEnvoyer = (texte: string): string | undefined => texte.trim() || undefined;

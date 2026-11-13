import type { EvenementProbleme } from '../types';
import { ROLE_LABELS } from './vocabulaire';

/**
 * Fil d'activité d'un problème : traduit les lignes de l'historique en phrases. Tout est pur (sans React). Règle d'honnêteté : on ne dit que ce que la ligne contient ;
 * un type inconnu devient « Autre événement » (jamais une phrase inventée) ; un auteur inconnu devient « Système » (jamais un nom deviné).
 */

export const TAILLE_PAGE_FIL = 10;
export const AUTEUR_INCONNU = 'Système';

export interface LigneFil {
  /** Phrase de l'événement, sans le titre d'action (affiché à part, entre guillemets). */
  texte: string;
  /** Titre de l'action concernée (événements d'action seulement). */
  detail: string | null;
}

const REOUVERT = 'reouverte';

/**
 * Une réouverture par une nouvelle action écrit DEUX lignes « action_creee » : « vérifiée → rouverte » (rendue « Problème rouvert »), puis « rouverte → action en cours »
 * (rendue « Action définie »). Le titre n'est donc écrit qu'une fois.
 */
export function libelleEvenement(e: Pick<EvenementProbleme, 'type_evenement' | 'ancien_statut' | 'nouveau_statut' | 'details'>): LigneFil {
  const rouvre = e.nouveau_statut === REOUVERT;
  const titre = e.details?.trim() || null;
  switch (e.type_evenement) {
    case 'creation': return { texte: 'Problème enregistré', detail: null };
    case 'feedback_rattache': return { texte: rouvre ? 'Avis rattaché : le problème est rouvert' : 'Avis rattaché', detail: null };
    case 'feedback_detache': return { texte: 'Avis détaché', detail: null };
    case 'feedback_deplace_entrant': return { texte: rouvre ? 'Avis déplacé depuis un autre problème : le problème est rouvert' : 'Avis déplacé depuis un autre problème', detail: null };
    case 'feedback_deplace_sortant': return { texte: 'Avis déplacé vers un autre problème', detail: null };
    case 'action_creee':
      return rouvre ? { texte: 'Problème rouvert : nouvelle action après la vérification', detail: null } : { texte: 'Action définie', detail: titre };
    case 'action_terminee': return { texte: 'Action terminée', detail: titre };
    case 'issue_resolue': return { texte: 'Problème résolu : toutes les actions sont terminées', detail: null };
    case 'issue_verifiee': return { texte: 'Résolution confirmée', detail: null };
    case 'delai_modifie': return { texte: 'Délai de traitement modifié', detail: null };
    case 'recurrence_modifiee': return { texte: 'Lien de récidive modifié', detail: null };
    default: return { texte: 'Autre événement', detail: null };
  }
}

/** L'auteur par son nom ; « Système » seulement quand la base n'en dit rien. */
export const libelleAuteur = (e: Pick<EvenementProbleme, 'auteur_nom'>): string => e.auteur_nom?.trim() || AUTEUR_INCONNU;

const ROLES: Record<string, string> = ROLE_LABELS;
/** Rôle lisible (infobulle) ; vide si la base ne le dit pas. */
export const libelleRole = (e: Pick<EvenementProbleme, 'auteur_role'>): string | null => (e.auteur_role ? ROLES[e.auteur_role] ?? null : null);

/** « Voir plus (12) » : le reste à charger, vrai (total du serveur moins ce qui est affiché) ; null s'il ne reste rien. */
export function libelleVoirPlus(affiches: number, total: number): string | null {
  const reste = total - affiches;
  return reste > 0 ? `Voir plus (${reste})` : null;
}

/** Annonce vocale après un chargement : combien d'événements viennent d'être ajoutés. */
export const annonceChargement = (ajoutes: number): string => (ajoutes > 0 ? `${ajoutes} événement${ajoutes > 1 ? 's' : ''} de plus affiché${ajoutes > 1 ? 's' : ''}.` : '');

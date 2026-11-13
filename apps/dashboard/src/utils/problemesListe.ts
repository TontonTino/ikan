import type { CriticiteType, Issue, IssueStatut } from '../types';
import { etatDelai, libelleJours } from './issueSuivi';
import type { NiveauUrgence } from './vocabulaire';

/**
 * Liste des problèmes : filtres serveur, texte d'avancement, navigation au clavier. Tout est pur (sans React) pour être testé.
 * Règle d'honnêteté : on n'affiche que ce que l'API calcule. `en_retard` à `null` (pas de délai, ou problème résolu) ne dit RIEN ; on n'écrit jamais « à l'heure ».
 */

export type TriListe = 'recent' | 'ancien';

export interface FiltresProblemes {
  /** Un vrai statut à la fois (l'API filtre sur un seul statut) ; null : tous. */
  statut: IssueStatut | null;
  /** Niveau d'urgence affiché (critique, élevée, normale) ; `normale` = faible ou moyenne côté API. */
  gravite: NiveauUrgence | null;
  enRetard: boolean;
  tri: TriListe;
  agenceId: string | null;
}

export const FILTRES_PAR_DEFAUT: FiltresProblemes = { statut: null, gravite: null, enRetard: false, tri: 'recent', agenceId: null };
export const TAILLE_PAGE = 50;

/** Vrai si un filtre autre que le tri et l'agence (choisie à part, en tête de page) restreint la liste. */
export const aDesFiltresActifs = (f: FiltresProblemes): boolean => f.statut !== null || f.gravite !== null || f.enRetard;

export interface ParametresListe {
  limit: number;
  offset: number;
  statut?: string;
  severite?: string;
  agence_id?: string;
  en_retard?: boolean;
  tri?: string;
}

/** Paramètres de `GET /issues/` : seuls les filtres actifs sont envoyés. */
export function parametresListe(f: FiltresProblemes, offset = 0, limit = TAILLE_PAGE): ParametresListe {
  const p: ParametresListe = { limit, offset };
  if (f.statut) p.statut = f.statut;
  if (f.gravite) p.severite = f.gravite;
  if (f.agenceId) p.agence_id = f.agenceId;
  if (f.enRetard) p.en_retard = true;
  if (f.tri === 'ancien') p.tri = 'ancien';
  return p;
}

type LigneRetard = Pick<Issue, 'statut' | 'severite' | 'premiere_detection' | 'date_limite_sla' | 'en_retard'>;

/**
 * Le retard, en MOTS (jamais par la seule couleur) : seulement si l'API dit `en_retard === true`. `false` et `null` : rien (on ne dit pas « à l'heure »,
 * faute de délai on ne sait pas, et un délai tenu n'est pas une information à afficher).
 */
export function texteRetard(issue: LigneRetard, maintenant: number): string | null {
  if (issue.en_retard !== true) return null;
  const delai = etatDelai(issue, maintenant);
  if (delai?.etat === 'depasse') return `Délai dépassé${delai.jours > 0 ? ` depuis ${libelleJours(delai.jours)}` : ' aujourd’hui'}`;
  return 'Délai dépassé';
}

type LigneActions = Pick<Issue, 'nb_actions' | 'nb_actions_a_faire'>;

/** « Aucune action définie » ou « 1 à faire sur 3 » : jamais un total d'actions « terminées » (les annulées n'en sont pas). Absent (ancien serveur) : null. */
export function texteActions(issue: LigneActions): string | null {
  if (issue.nb_actions === undefined || issue.nb_actions === null) return null;
  if (issue.nb_actions === 0) return 'Aucune action définie';
  const faire = issue.nb_actions_a_faire ?? 0;
  return faire === 0 ? `Aucune à faire sur ${issue.nb_actions}` : `${faire} à faire sur ${issue.nb_actions}`;
}

export const texteAvis = (issue: Pick<Issue, 'nb_avis'>): string | null =>
  issue.nb_avis === undefined || issue.nb_avis === null ? null : issue.nb_avis === 0 ? 'Aucun avis' : `${issue.nb_avis} avis`;

/**
 * Ligne suivante selon la touche (flèches, Début, Fin) dans une liste de `total` lignes ; null si la touche n'est pas de navigation.
 * Pas de rebouclage : aux extrémités on reste sur place (repère clair pour le clavier et les lecteurs d'écran).
 */
export function ligneSuivante(touche: string, index: number, total: number): number | null {
  if (total <= 0) return null;
  switch (touche) {
    case 'ArrowDown': return Math.min(index + 1, total - 1);
    case 'ArrowUp': return Math.max(index - 1, 0);
    case 'Home': return 0;
    case 'End': return total - 1;
    default: return null;
  }
}

/** Phrase annoncée aux lecteurs d'écran quand la liste change (vraie : total serveur, lignes chargées). */
export function annonceListe(charges: number, total: number, filtres: boolean): string {
  if (total === 0) return filtres ? 'Aucun problème pour ces filtres.' : 'Aucun problème suivi.';
  const sur = charges < total ? `${charges} chargés sur ${total}` : `${total}`;
  return `${sur} problème${total > 1 ? 's' : ''}${filtres ? ' pour ces filtres' : ''}.`;
}

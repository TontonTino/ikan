import type { ActionProbleme, Feedback, UserRole } from '../types';
import { RESPONSABLE_CX } from './vocabulaire';

/**
 * Page « Actions à mener » : une liste unique qui agrège les actions décidées sur un AVIS (champ « action à prendre » d'un avis) et les actions d'un PROBLÈME
 * (`GET /issues/actions`). Tout est pur (sans React) pour être testé. Règle d'honnêteté : aucun statut, aucune échéance ni aucun retard inventés ; une action sur avis
 * n'a ni échéance ni retard.
 */

export type Origine = 'probleme' | 'avis';
export type SegmentActions = 'en_cours' | 'terminees';
export type TypeActions = 'tous' | Origine;

export interface FiltresActions {
  segment: SegmentActions;
  type: TypeActions;
  enRetard: boolean;
  /** Mes actions : les actions de problème dont je suis le responsable. */
  mesActions: boolean;
  agenceId: string | null;
}

export const FILTRES_ACTIONS_PAR_DEFAUT: FiltresActions = { segment: 'en_cours', type: 'tous', enRetard: false, mesActions: false, agenceId: null };
export const TAILLE_PAGE_ACTIONS = 50;

/** Filtres qui restreignent la liste (le segment et l'agence se choisissent à part, en tête de page). */
export const aDesFiltresActions = (f: FiltresActions): boolean => f.type !== 'tous' || f.enRetard || f.mesActions;

/** Les actions sur avis n'ont ni échéance (jamais en retard) ni responsable au sens des problèmes : « En retard » et « Mes actions » ne les concernent pas. */
export const interrogerLesAvis = (f: FiltresActions): boolean => f.type !== 'probleme' && !f.enRetard && !f.mesActions;
export const interrogerLesProblemes = (f: FiltresActions): boolean => f.type !== 'avis';

export interface ParametresActionsProbleme {
  limit: number;
  offset: number;
  etat: 'a_faire' | 'terminee';
  en_retard?: boolean;
  responsable_id?: string;
  agence_id?: string;
}

/** Paramètres de `GET /issues/actions` : l'état vient du segment, les autres filtres seulement s'ils sont actifs. */
export function parametresActionsProbleme(f: FiltresActions, moiId: string | undefined, offset = 0, limit = TAILLE_PAGE_ACTIONS, segment: SegmentActions = f.segment): ParametresActionsProbleme {
  const p: ParametresActionsProbleme = { limit, offset, etat: segment === 'terminees' ? 'terminee' : 'a_faire' };
  if (f.enRetard && segment !== 'terminees') p.en_retard = true;           // une action terminée n'est jamais « en retard » : le filtre ne s'applique qu'à « En cours »
  if (f.mesActions && moiId) p.responsable_id = moiId;
  if (f.agenceId) p.agence_id = f.agenceId;
  return p;
}

/** Une ligne de la liste unique, quelle que soit l'origine. */
export interface LigneAction {
  cle: string;
  origine: Origine;
  /** Identifiant de l'action (de problème) ou de l'avis (action sur avis). */
  id: string;
  titre: string;
  agenceId?: string;
  agenceNom?: string | null;
  responsableId?: string | null;
  /** Nom du responsable (problème) ou de la personne qui a pris l'avis en charge. Absent : « sans responsable ». */
  responsableNom?: string | null;
  echeance?: string | null;
  enRetard: boolean | null;
  /** Date de définition (problème) ou de prise en charge (avis) : sert à l'ancienneté et au tri. */
  depuis?: string | null;
  terminee: boolean;
  dateFin?: string | null;
  // Problème d'origine (actions de problème)
  issueId?: string;
  issueTitre?: string;
  derniereAFaire?: boolean;
  // Avis d'origine (actions sur avis)
  avisNote?: number;
  avisDate?: string;
  avisCommentaire?: string | null;
  issueRattacheId?: string | null;
}

export const ligneDepuisProbleme = (a: ActionProbleme): LigneAction => ({
  cle: `probleme-${a.id}`, origine: 'probleme', id: a.id, titre: a.titre, agenceId: a.agence_id, agenceNom: a.agence_nom,
  responsableId: a.responsable_id ?? null, responsableNom: a.responsable_nom ?? null, echeance: a.echeance ?? null, enRetard: a.en_retard ?? null,
  depuis: a.created_at, terminee: a.statut === 'terminee', dateFin: a.date_completion ?? null, issueId: a.issue_id, issueTitre: a.issue_titre, derniereAFaire: a.derniere_a_faire,
});

export const ligneDepuisAvis = (f: Feedback): LigneAction => ({
  cle: `avis-${f.id}`, origine: 'avis', id: f.id, titre: f.action_a_prendre || 'Action non détaillée', agenceId: f.agence_id, agenceNom: f.agence_nom,
  responsableId: null, responsableNom: f.assigne_a_nom ?? null, echeance: null, enRetard: null, depuis: f.date_assignation ?? null, terminee: !!f.action_realisee,
  dateFin: f.date_resolution ?? null, avisNote: f.note, avisDate: f.date_soumission, avisCommentaire: f.commentaire ?? null, issueRattacheId: f.issue_id ?? null,
});

const temps = (iso?: string | null): number => (iso ? new Date(iso).getTime() : NaN);

/**
 * Ordre d'une liste « En cours » : d'abord les actions en retard, puis celles qui ont une échéance (la plus proche d'abord), puis les autres, de la plus ancienne
 * à la plus récente. « Terminées » : la plus récemment terminée d'abord. Le tri porte sur les lignes CHARGÉES (le serveur trie chaque source de la même façon).
 */
export function trierLignes(lignes: LigneAction[], segment: SegmentActions): LigneAction[] {
  const valeur = (n: number, defaut: number) => (Number.isNaN(n) ? defaut : n);
  const copie = [...lignes];
  if (segment === 'terminees') return copie.sort((a, b) => valeur(temps(b.dateFin), 0) - valeur(temps(a.dateFin), 0));
  const rang = (l: LigneAction) => (l.enRetard === true ? 0 : !Number.isNaN(temps(l.echeance)) ? 1 : 2);
  return copie.sort((a, b) =>
    rang(a) - rang(b) ||
    (rang(a) < 2 ? valeur(temps(a.echeance), Infinity) - valeur(temps(b.echeance), Infinity) : valeur(temps(a.depuis), Infinity) - valeur(temps(b.depuis), Infinity)) ||
    a.cle.localeCompare(b.cle));
}

/** Terminer une action de problème : le CX Manager toujours ; l'Agency Manager seulement SES actions (dont il est le responsable). Décision de parcours, appliquée ici (l'API est plus large). */
export function peutTerminerLigne(l: LigneAction, role: UserRole | undefined, moiId: string | undefined): boolean {
  if (l.origine !== 'probleme' || l.terminee) return false;
  if (role === 'cx_manager') return true;
  return role === 'agency_manager' && !!moiId && l.responsableId === moiId;
}

/** Le retard, en mots : seulement si l'API dit `en_retard === true` ; jamais « à l'heure ». */
export const texteRetardAction = (l: Pick<LigneAction, 'enRetard'>): string | null => (l.enRetard === true ? 'Échéance dépassée' : null);

/** Un total est vrai seulement s'il est lisible ; « 3 chargées sur 120 » sinon rien n'est dit. */
export function libelleChargement(charges: number, total: number): string | null {
  return charges < total ? `${charges} actions chargées sur ${total}.` : null;
}

// ── Textes de la page, tels quels ─────────────────────────────────────────────────────────────────────────────────────────────
export const TEXTE_VIDE_EN_COURS_RESEAU =
  'Aucune action n’est en cours. Une action apparaît ici quand vous la définissez sur un problème (« Définir une action »), ou sur un avis déjà pris en charge par le Responsable d’agence. Elle passe dans « Terminées » une fois réalisée.';
export const TEXTE_VIDE_EN_COURS_AGENCE =
  `Aucune action n’est en cours dans votre agence. Une action apparaît ici quand votre ${RESPONSABLE_CX} la définit sur un problème de votre agence, ou sur un avis que vous avez pris en charge. Elle passe dans « Terminées » une fois réalisée.`;
export const TEXTE_VIDE_TERMINEES = 'Les actions terminées, sur un problème ou sur un avis, apparaîtront ici.';
export const NOTE_EN_RETARD = 'Les actions sur un avis n’ont pas d’échéance : elles ne sont pas concernées par « En retard ».';
export const NOTE_MES_ACTIONS = '« Mes actions » ne concerne que les actions de problème : une action sur un avis n’a pas de responsable désigné.';
export const NOTE_TERMINEES = 'Une action terminée indique qu’elle a été faite, pas que le client est satisfait : vérifiez-le dans les nouveaux avis de l’agence.';

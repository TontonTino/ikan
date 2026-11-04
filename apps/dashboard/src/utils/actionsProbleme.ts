import axios from 'axios';
import type { ActionCorrective, IssueStatut, UserRole } from '../types';

/**
 * Définir et terminer une action depuis un problème : droits, saisie, classement des échecs.
 * Tout ce qui se décide ici est pur (sans React) pour être testé ; les boîtes de dialogue ne font qu'afficher.
 */

// ── Droits ────────────────────────────────────────────────────────────────────────────────────────
// Backend (issues.py, `get_cx_or_agency_manager` + `verifier_acces_issue`) : le CX Manager et l'Agency Manager de l'agence du problème peuvent créer et
// terminer une action. Décision de parcours : le CX Manager décide et crée l'action ; l'Agency Manager l'exécute (la termine). Ces listes sont le SEUL endroit
// à changer si cette décision évolue (le bouton ne s'affiche qu'aux rôles listés ; aucun bouton grisé sans explication).
export const ROLES_DEFINIR_ACTION: readonly UserRole[] = ['cx_manager'];
export const ROLES_TERMINER_ACTION: readonly UserRole[] = ['cx_manager', 'agency_manager'];
/** Vérifier qu'un problème est réellement réglé : le CX Manager seul (décision de parcours ; l'API le permet encore à l'Agency Manager, voir PR 3). */
export const ROLES_VERIFIER_RESOLUTION: readonly UserRole[] = ['cx_manager'];

/** Statuts où définir une action a un sens. « Résolu » / « Vérifié » : réouverture et annulation viennent plus tard, rien n'est proposé. */
export const STATUTS_DEFINIR_ACTION: readonly IssueStatut[] = ['ouverte', 'reouverte', 'action_en_cours'];

export const peutDefinirAction = (role: UserRole | undefined, statut: IssueStatut): boolean =>
  !!role && ROLES_DEFINIR_ACTION.includes(role) && STATUTS_DEFINIR_ACTION.includes(statut);
export const peutTerminerAction = (role: UserRole | undefined): boolean => !!role && ROLES_TERMINER_ACTION.includes(role);
export const peutVerifierResolution = (role: UserRole | undefined): boolean => !!role && ROLES_VERIFIER_RESOLUTION.includes(role);

// ── Saisie ────────────────────────────────────────────────────────────────────────────────────────
/** Limites de l'API (`ActionCorrectiveCreate.titre` : 3 à 200 caractères). La description n'a pas de limite côté API : 500 caractères par cohérence avec les commentaires. */
export const TITRE_MIN = 3;
export const TITRE_MAX = 200;
export const DESCRIPTION_MAX = 500;
/** Valeur du sélecteur pour « aucun responsable pour l'instant » : un choix explicite, jamais un défaut silencieux. */
export const SANS_RESPONSABLE = '__sans__';

export interface SaisieAction {
  titre: string;
  description: string;
  /** '' : pas encore choisi ; SANS_RESPONSABLE ; sinon l'id de la personne. */
  responsableId: string;
  /** Jour au format « 2026-11-12 » (champ date) ; '' : sans échéance. */
  echeance: string;
}

export const SAISIE_VIDE: SaisieAction = { titre: '', description: '', responsableId: '', echeance: '' };

export type ChampAction = 'titre' | 'responsable' | 'echeance';
export type ErreursSaisie = Partial<Record<ChampAction, string>>;

/** Jour local « 2026-11-04 » d'une date. */
export const jourLocal = (date: Date = new Date()): string => {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const j = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${j}`;
};

/** Contrôle la saisie avant l'envoi. `aujourdhui` : « 2026-11-04 » (injectable pour les tests). */
export function validerSaisie(saisie: SaisieAction, aujourdhui: string = jourLocal()): ErreursSaisie {
  const erreurs: ErreursSaisie = {};
  const titre = saisie.titre.trim();
  if (titre.length < TITRE_MIN) erreurs.titre = `Décrivez l’action en ${TITRE_MIN} caractères minimum.`;
  else if (titre.length > TITRE_MAX) erreurs.titre = `L’action ne peut pas dépasser ${TITRE_MAX} caractères.`;
  if (!saisie.responsableId) erreurs.responsable = 'Choisissez un responsable, ou « Sans responsable pour l’instant ».';
  if (saisie.echeance && !/^\d{4}-\d{2}-\d{2}$/.test(saisie.echeance)) erreurs.echeance = 'Indiquez une date valide.';
  else if (saisie.echeance && saisie.echeance < aujourdhui) erreurs.echeance = 'L’échéance ne peut pas être dans le passé.';
  return erreurs;
}

/** Midi UTC du jour choisi : le même jour du calendrier pour toute personne entre UTC−11 et UTC+11 (l'API attend un horodatage, pas un jour). */
export const echeanceVersIso = (jour: string): string => `${jour}T12:00:00Z`;

export interface ChargeCreationAction {
  titre: string;
  description?: string;
  responsable_id?: string;
  echeance?: string;
}

/** Corps envoyé à `POST /issues/{id}/actions` : champs nettoyés, facultatifs absents s'ils sont vides. */
export function chargeCreation(saisie: SaisieAction): ChargeCreationAction {
  const description = saisie.description.trim();
  return {
    titre: saisie.titre.trim(),
    ...(description ? { description } : {}),
    ...(saisie.responsableId && saisie.responsableId !== SANS_RESPONSABLE ? { responsable_id: saisie.responsableId } : {}),
    ...(saisie.echeance ? { echeance: echeanceVersIso(saisie.echeance) } : {}),
  };
}

export const compteurDescription = (valeur: string): string => `${valeur.length} / ${DESCRIPTION_MAX} caractères`;

// ── Responsables proposés ─────────────────────────────────────────────────────────────────────────
/** Ce que `GET /utilisateurs/` renvoie au CX Manager (les Agency Managers de l'organisation) : seuls les champs utiles. */
export interface UtilisateurListe {
  id: string;
  nom: string;
  prenom: string;
  role: UserRole;
  agence_id: string | null;
  active: boolean;
}

export interface Personne {
  id: string;
  libelle: string;
}

export const nomComplet = (u: { prenom: string; nom: string }): string => `${u.prenom} ${u.nom}`.trim();

/**
 * Personnes qu'on peut désigner pour un problème : les Agency Managers ACTIFS de l'agence du problème (rien d'une autre agence : l'API accepterait
 * mais la personne ne pourrait pas ouvrir le problème, 403), plus soi-même (CX Manager, accès à toutes les agences). Les autres CX Managers ne sont
 * pas listés : aucun endpoint ne les expose.
 */
export function personnesAssignables(utilisateurs: readonly UtilisateurListe[], agenceId: string, moi: { id: string; prenom: string; nom: string }): Personne[] {
  const agence = utilisateurs
    .filter((u) => u.role === 'agency_manager' && u.active && u.agence_id === agenceId && u.id !== moi.id)
    .map((u) => ({ id: u.id, libelle: nomComplet(u) }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
  return [{ id: moi.id, libelle: `Moi (${nomComplet(moi)})` }, ...agence];
}

/** Nom affichable d'un responsable : « Vous », le nom s'il est connu, sinon « Assigné » (l'API n'expose pas de nom : jamais inventé). */
export function libelleResponsable(responsableId: string | undefined | null, personnes: readonly UtilisateurListe[], moiId: string | undefined): string {
  if (!responsableId) return 'Sans responsable';
  if (responsableId === moiId) return 'Vous';
  const trouve = personnes.find((u) => u.id === responsableId);
  return trouve ? nomComplet(trouve) : 'Assigné';
}

// ── Échecs ────────────────────────────────────────────────────────────────────────────────────────
/**
 * - `saisie`   : la donnée est refusée (400/422) ; la boîte reste ouverte, la saisie est conservée, on corrige puis on renvoie.
 * - `refus`    : 403, droits insuffisants ; pas de « Réessayer » (inutile), la saisie est conservée.
 * - `disparu`  : 404/409, le problème ou l'action n'est plus dans l'état attendu ; la boîte se ferme et la page rafraîchit.
 * - `serveur`  : 5xx, réseau, délai ; la boîte reste ouverte, la saisie est conservée, « Réessayer ».
 */
export type NatureEchec = 'saisie' | 'refus' | 'disparu' | 'serveur';
export interface EchecAction {
  nature: NatureEchec;
  message: string;
}

export const MESSAGES_DEFINIR = {
  refus: 'Vous n’avez pas accès à ce problème : l’action n’a pas été créée.',
  introuvable: 'Ce problème n’existe plus. La liste vient d’être actualisée.',
  conflit: 'Ce problème a changé entre-temps : l’action n’a pas été créée. La liste vient d’être actualisée.',
  saisie: 'Certaines informations ne sont pas valides. Vérifiez l’action (3 à 200 caractères), le responsable et l’échéance, puis réessayez.',
  responsable: 'Ce responsable ne peut pas être désigné pour ce problème. Choisissez une autre personne.',
  serveur: 'L’action n’a pas pu être enregistrée. Votre saisie est conservée : réessayez.',
  reseau: 'Impossible de joindre le service. Votre saisie est conservée : vérifiez votre connexion puis réessayez.',
} as const;

export const MESSAGES_TERMINER = {
  refus: 'Vous n’avez pas accès à ce problème : l’action n’a pas été terminée.',
  introuvable: 'Cette action n’existe plus. La liste vient d’être actualisée.',
  conflit: 'Cette action a changé entre-temps (elle est peut-être déjà terminée). La liste vient d’être actualisée.',
  saisie: 'Cette action ne peut pas être terminée dans son état actuel.',
  serveur: 'L’action n’a pas pu être terminée. Réessayez.',
  reseau: 'Impossible de joindre le service. Vérifiez votre connexion puis réessayez.',
} as const;

type Messages = typeof MESSAGES_DEFINIR | typeof MESSAGES_TERMINER;

/** Classe l'échec d'un appel. Le texte brut du serveur n'est jamais affiché ; seule la gravité du code HTTP compte. */
export function classerEchecAction(erreur: unknown, messages: Messages, definir = true): EchecAction {
  if (!axios.isAxiosError(erreur)) return { nature: 'serveur', message: messages.serveur };
  const statut = erreur.response?.status;
  if (!statut) return { nature: 'serveur', message: messages.reseau };
  if (statut === 403) return { nature: 'refus', message: messages.refus };
  if (statut === 404) return { nature: 'disparu', message: messages.introuvable };
  if (statut === 409) return { nature: 'disparu', message: messages.conflit };
  if (statut === 422) return { nature: 'saisie', message: messages.saisie };
  if (statut === 400) {
    const detail = (erreur.response?.data as { detail?: unknown } | undefined)?.detail;
    const surResponsable = definir && typeof detail === 'string' && /responsable/i.test(detail);
    return { nature: 'saisie', message: surResponsable ? MESSAGES_DEFINIR.responsable : messages.saisie };
  }
  return { nature: 'serveur', message: messages.serveur };
}

export type ResultatCreation = { type: 'succes'; action: ActionCorrective } | ({ type: 'echec' } & EchecAction);
export type ResultatTerminaison = { type: 'succes' } | ({ type: 'echec' } & EchecAction);

/** Crée l'action et classe le résultat. Ne lève jamais. */
export async function envoyerCreationAction(
  creer: (issueId: string, charge: ChargeCreationAction) => Promise<{ data: ActionCorrective }>,
  issueId: string,
  saisie: SaisieAction,
): Promise<ResultatCreation> {
  try {
    const res = await creer(issueId, chargeCreation(saisie));
    return { type: 'succes', action: res.data };
  } catch (e) {
    return { type: 'echec', ...classerEchecAction(e, MESSAGES_DEFINIR) };
  }
}

/** Termine l'action et classe le résultat. Ne lève jamais. */
export async function envoyerTerminaison(
  terminer: (issueId: string, actionId: string) => Promise<unknown>,
  issueId: string,
  actionId: string,
): Promise<ResultatTerminaison> {
  try {
    await terminer(issueId, actionId);
    return { type: 'succes' };
  } catch (e) {
    return { type: 'echec', ...classerEchecAction(e, MESSAGES_TERMINER, false) };
  }
}

/** Libellé de l'état d'une action de problème (vocabulaire de l'interface). */
export const libelleEtatAction = (statut: string): string => (statut === 'terminee' ? 'Terminée' : statut === 'annulee' ? 'Annulée' : 'À faire');

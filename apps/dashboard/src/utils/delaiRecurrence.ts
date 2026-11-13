import axios from 'axios';
import type { Issue, IssueStatut, UserRole } from '../types';
import { shortDate } from '../components/ui/format';
import { RESPONSABLE_CX } from './vocabulaire';

/**
 * Délai de traitement et récurrence d'un problème : décidés par le CX Manager (règle appliquée par le serveur ; l'interface ne fait que la refléter).
 * Tout est pur (sans React). Rien n'est inventé : sans délai, on n'affiche jamais « à l'heure » ; sans origine, on n'affiche aucune récidive.
 */

export const ROLES_FIXER_DELAI_RECURRENCE: readonly UserRole[] = ['cx_manager'];
export const peutFixerDelaiRecurrence = (role: UserRole | undefined): boolean => !!role && ROLES_FIXER_DELAI_RECURRENCE.includes(role);

/** Dit à l'Agency Manager qui décide (rien n'est grisé sans explication). */
export const PHRASE_QUI_DECIDE = `Le délai de traitement et la récurrence sont fixés par le ${RESPONSABLE_CX}.`;

const RESOLUS: readonly IssueStatut[] = ['resolue', 'verifiee'];
/** Un problème résolu ou vérifié n'accepte plus de délai (un délai posé après coup fausserait le respect du délai) ; la récurrence reste modifiable. */
export const delaiModifiable = (statut: IssueStatut): boolean => !RESOLUS.includes(statut);

/** Midi UTC du jour choisi : le même jour du calendrier pour toute personne entre UTC−11 et UTC+11 (comme l'échéance d'une action). */
export const delaiVersIso = (jour: string): string => `${jour}T12:00:00Z`;

/** Jour « 2026-11-12 » d'un délai déjà enregistré, pour préremplir le champ. */
export const jourDuDelai = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** Contrôle avant l'envoi ; null si la saisie est valable. Même règle que le serveur : le délai suit la première détection du problème. */
export function validerDelai(jour: string, premiereDetection: string): string | null {
  if (!jour) return 'Choisissez une date, ou utilisez « Effacer le délai ».';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || Number.isNaN(new Date(delaiVersIso(jour)).getTime())) return 'Indiquez une date valide.';
  const detection = new Date(premiereDetection).getTime();
  if (!Number.isNaN(detection) && new Date(delaiVersIso(jour)).getTime() <= detection) {
    return `Le délai doit être postérieur à l’enregistrement du problème (${shortDate(premiereDetection)}).`;
  }
  return null;
}

/** Nombre maximal de problèmes proposés par statut dans le choix de l'origine. */
export const LIMITE_CANDIDATS = 100;

type Candidat = Pick<Issue, 'id' | 'titre' | 'statut' | 'premiere_detection' | 'issue_origine_id' | 'agence_nom'>;

/**
 * Problèmes qui peuvent servir d'origine à `issue` : même règle que le serveur (résolu ou vérifié, lui-même non récurrent, plus ancien, pas le problème lui-même),
 * du plus récent au plus ancien. Le serveur reste juge : cette liste évite seulement de proposer ce qui sera refusé.
 */
export function candidatsOrigine(liste: readonly Candidat[], issue: Pick<Issue, 'id' | 'premiere_detection'>): Candidat[] {
  const limite = new Date(issue.premiere_detection).getTime();
  return liste
    .filter((c) => c.id !== issue.id && !c.issue_origine_id && RESOLUS.includes(c.statut) && new Date(c.premiere_detection).getTime() < limite)
    .sort((a, b) => new Date(b.premiere_detection).getTime() - new Date(a.premiere_detection).getTime());
}

/** Libellé d'un choix : le titre d'abord, puis l'agence (jamais un identifiant). */
export const libelleCandidat = (c: Pick<Candidat, 'titre' | 'agence_nom'>): string => (c.agence_nom ? `${c.titre} · ${c.agence_nom}` : c.titre);

/** « 5 problèmes proposés » ; dit la vérité quand la liste est tronquée. */
export const libelleTroncature = (proposes: number, total: number): string | null =>
  total > proposes ? `Seuls les ${proposes} problèmes résolus les plus récents sont proposés (sur ${total}).` : null;

// ── Envoi ──────────────────────────────────────────────────────────────────────

export type NatureEchecDR = 'saisie' | 'refus' | 'disparu' | 'serveur';
export interface EchecDR { nature: NatureEchecDR; message: string }

export const MESSAGES_DELAI_RECURRENCE = {
  refus: `Seul le ${RESPONSABLE_CX} peut modifier le délai et la récurrence. Rien n’a été enregistré.`,
  introuvable: 'Ce problème n’existe plus. Le détail vient d’être actualisé.',
  conflit: 'Ce problème a changé entre-temps (il est peut-être déjà résolu, ou d’autres problèmes lui sont liés). Le détail vient d’être actualisé.',
  saisie: 'Cette valeur n’est pas acceptée. Vérifiez la date ou le problème choisi, puis réessayez.',
  serveur: 'La modification n’a pas pu être enregistrée. Votre saisie est conservée : réessayez.',
  reseau: 'Impossible de joindre le service. Votre saisie est conservée : vérifiez votre connexion puis réessayez.',
} as const;

/** Classe l'échec d'un appel. Le texte brut du serveur n'est jamais affiché ; seule la gravité du code HTTP compte. */
export function classerEchecDelaiRecurrence(erreur: unknown): EchecDR {
  const m = MESSAGES_DELAI_RECURRENCE;
  if (!axios.isAxiosError(erreur)) return { nature: 'serveur', message: m.serveur };
  const statut = erreur.response?.status;
  if (!statut) return { nature: 'serveur', message: m.reseau };
  if (statut === 403) return { nature: 'refus', message: m.refus };
  if (statut === 404) return { nature: 'disparu', message: m.introuvable };
  if (statut === 409) return { nature: 'disparu', message: m.conflit };
  if (statut === 400 || statut === 422) return { nature: 'saisie', message: m.saisie };
  return { nature: 'serveur', message: m.serveur };
}

export type ChargeDelaiRecurrence = { date_limite_sla?: string | null; issue_origine_id?: string | null };
export type ResultatDR = { type: 'succes' } | ({ type: 'echec' } & EchecDR);

/** Envoie la modification et classe le résultat. Ne lève jamais. */
export async function envoyerDelaiRecurrence(
  modifier: (issueId: string, charge: ChargeDelaiRecurrence) => Promise<unknown>,
  issueId: string,
  charge: ChargeDelaiRecurrence,
): Promise<ResultatDR> {
  try {
    await modifier(issueId, charge);
    return { type: 'succes' };
  } catch (e) {
    return { type: 'echec', ...classerEchecDelaiRecurrence(e) };
  }
}

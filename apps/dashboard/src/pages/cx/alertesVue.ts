import type { Alerte, AlerteFeedback } from '../../types';
import { formaterNombre } from '../../utils/formatNombre';
import { estAvisPrisEnCharge } from '../../components/alerts/alerteLabels';
import { RESPONSABLE_CX } from '../../utils/vocabulaire';

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
/** Avis à risque affichés d'emblée (un groupe) ; les suivants se déplient d'un coup, sans rien masquer définitivement. */
export const AVIS_VISIBLES = 5;

export const tonAvis = (note: number): TonAlerte => (note <= NOTE_CRITIQUE_MAX ? 'critical' : 'warning');

/** Critiques d'abord, puis du plus récent au plus ancien (ordre déjà fourni par l'API). */
export function trierAvis(avis: AlerteFeedback[]): AlerteFeedback[] {
  return [...avis].sort((a, b) => {
    const ta = tonAvis(a.note) === 'critical' ? 0 : 1;
    const tb = tonAvis(b.note) === 'critical' ? 0 : 1;
    return ta - tb || new Date(b.date_soumission).getTime() - new Date(a.date_soumission).getTime();
  });
}

/**
 * Note discrète sur l'ordre des avis : donnée seulement quand il y a de quoi trier (au moins deux avis). « Critiques d'abord » n'est dit que si les deux
 * niveaux sont présents, sinon l'ordre ne dépend que de la date.
 */
export function noteTriAvis(avis: AlerteFeedback[]): string | null {
  if (avis.length < 2) return null;
  const critiques = avis.filter((a) => tonAvis(a.note) === 'critical').length;
  return critiques > 0 && critiques < avis.length ? 'Critiques d’abord, puis du plus récent au plus ancien.' : 'Du plus récent au plus ancien.';
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

export interface SyntheseAlertes {
  /** Alertes de seuil + avis à risque (les « situations à surveiller »). Jamais confondu avec les événements détectés. */
  situations: number;
  seuil: number;
  avis: number;
  /** Parmi ces avis à risque, ceux déjà pris en charge (statut « en_traitement » ou « en_cours »). Information seule : n'entre dans aucun total. */
  avisPrisEnCharge: number;
  /** Agences distinctes concernées : renseigné pour le CX Manager seulement (null sinon). */
  agences: number | null;
  /** Date (ISO) de l'avis à risque le plus ancien, si au moins une date est valide. Les alertes de seuil n'ont pas de date : elles ne comptent pas. */
  avisLePlusAncien: string | null;
}

/** Synthèse calculée sur les alertes DÉJÀ chargées (aucun appel, aucun statut inventé), pour le périmètre d'agence choisi. Null s'il n'y a rien à surveiller. */
export function syntheseAlertes(entrees: { seuil: Alerte[]; avis: AlerteFeedback[]; agenceId: string | null; cx: boolean }): SyntheseAlertes | null {
  const { agenceId, cx } = entrees;
  const seuil = entrees.seuil.filter((a) => !agenceId || a.agence_id === agenceId);
  const avis = entrees.avis.filter((a) => !agenceId || a.agence_id === agenceId);
  const situations = seuil.length + avis.length;
  if (situations === 0) return null;
  const agences = new Set([...seuil.map((a) => a.agence_id), ...avis.map((a) => a.agence_id)].filter(Boolean));
  const dates = avis.map((a) => new Date(a.date_soumission).getTime()).filter((t) => Number.isFinite(t));
  return {
    situations, seuil: seuil.length, avis: avis.length, avisPrisEnCharge: avis.filter((a) => estAvisPrisEnCharge(a.statut_traitement)).length,
    agences: cx && agences.size > 0 ? agences.size : null,
    avisLePlusAncien: dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null,
  };
}

/** Les deux moitiés de la phrase de synthèse, séparées pour la mise en page : « 3 alertes actives » et « 2 alertes de seuil, 16 avis à traiter ». Une partie à zéro est omise (jamais « 0 » par défaut). */
export function partiesSynthese(s: SyntheseAlertes): { titre: string; detail: string } {
  const detail: string[] = [];
  if (s.seuil > 0) detail.push(`${formaterNombre(s.seuil, 0)} alerte${s.seuil > 1 ? 's' : ''} de seuil`);
  if (s.avis > 0) detail.push(`${formaterNombre(s.avis, 0)} avis à traiter${s.avisPrisEnCharge > 0 ? `, dont ${formaterNombre(s.avisPrisEnCharge, 0)} pris en charge` : ''}`);
  return { titre: `${formaterNombre(s.situations, 0)} alerte${s.situations > 1 ? 's' : ''} active${s.situations > 1 ? 's' : ''}`, detail: detail.join(', ') };
}

/** « 3 alertes actives : 2 alertes de seuil, 1 avis à traiter ». */
export function phraseSynthese(s: SyntheseAlertes): string {
  const { titre, detail } = partiesSynthese(s);
  return `${titre} : ${detail}`;
}

/** Coupe un texte en morceaux { texte, nombre } pour mettre les chiffres en valeur sans modifier le texte (« 1 234 » reste un seul nombre). */
export function decouperChiffres(texte: string): Array<{ texte: string; nombre: boolean }> {
  return texte
    .split(/(\d+(?:[\u202f\u00a0]\d{3})*)/)
    .filter((t) => t !== '')
    .map((t) => ({ texte: t, nombre: /^\d/.test(t) }));
}

/** Part complémentaire de la synthèse (CX Manager : agences concernées). Vide si l'information manque. */
export function phraseAgencesConcernees(s: SyntheseAlertes): string | null {
  return s.agences === null ? null : `${formaterNombre(s.agences, 0)} agence${s.agences > 1 ? 's' : ''} concernée${s.agences > 1 ? 's' : ''}`;
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

/** Libellé du bouton qui déplie ou replie les avis : « Voir les N avis » (N = avis encore masqués), « Voir l'avis restant » s'il n'en reste qu'un, « Réduire » une fois dépliée. */
export function libelleVoirAvis(total: number, depliee: boolean, limite = AVIS_VISIBLES): string {
  if (depliee) return 'Réduire';
  const masques = total - limite;
  return masques > 1 ? `Voir les ${masques} avis` : 'Voir l’avis restant';
}

/** Message de forfait : explicite, jamais confondu avec « aucune alerte ». */
export function messageForfait(nomForfait: string | null, cx: boolean): { titre: string; detail: string } {
  return {
    titre: nomForfait ? `Les alertes de satisfaction ne sont pas incluses dans le forfait ${nomForfait}` : 'Les alertes de satisfaction ne sont pas incluses dans le forfait de votre organisation',
    detail: cx
      ? 'Cette liste est vide parce que la fonctionnalité n’est pas disponible, pas parce que la satisfaction du réseau est bonne.'
      : `Cette liste est vide parce que la fonctionnalité n’est pas disponible, pas parce que la satisfaction de votre agence est bonne. Rapprochez-vous de votre ${RESPONSABLE_CX} pour faire évoluer le forfait.`,
  };
}

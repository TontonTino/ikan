import axios from 'axios';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Alerte, CauseFinEpisode, EpisodeHistorique, StatutEpisode } from '../types';
import { dateRelativeOuAbsolue } from '../components/ui/format';
import { formaterNombre } from './formatNombre';
import { userFacingError } from './userFacingError';

/**
 * Cycle de vie des alertes de seuil (épisodes) : libellés, dates, durées, messages d'erreur et états de l'historique.
 * Tout provient du serveur (GET /alertes/, /alertes/episodes, /alertes/episodes/{id}) : aucune date, aucune durée ni aucun état n'est inventé.
 * Le début d'un épisode est RECONSTITUÉ d'après les avis : il est toujours dit « environ » (ou « au moins » s'il est tronqué), jamais certain.
 */

// ── Libellés ───────────────────────────────────────────────────────────────────────────────────────

export const STATUT_EPISODE_LABELS: Record<StatutEpisode, string> = {
  detectee: 'Détectée',
  prise_en_charge: 'Prise en charge',
  terminee: 'Terminée',
};

/** Libellé d'un état d'épisode ; une valeur inconnue ne s'affiche jamais en clé technique (null : l'appelant n'affiche rien). */
export const libelleStatutEpisode = (statut: string | null | undefined): string | null =>
  statut && Object.prototype.hasOwnProperty.call(STATUT_EPISODE_LABELS, statut) ? STATUT_EPISODE_LABELS[statut as StatutEpisode] : null;

export const CAUSE_FIN_LABELS: Record<CauseFinEpisode, string> = {
  retablie: 'Situation rétablie',
  donnees_insuffisantes: 'Données insuffisantes',
  seuil_modifie: 'Seuil modifié',
  agence_desactivee: 'Agence désactivée',
};

/** Explication d'une cause de fin, en une phrase (tiroir de détail). La première (« rétablie ») est la seule bonne nouvelle : les autres ne sont pas une amélioration. */
export const CAUSE_FIN_EXPLICATIONS: Record<CauseFinEpisode, string> = {
  retablie: 'La satisfaction des 7 derniers jours est repassée au-dessus du seuil.',
  donnees_insuffisantes: 'Il n’y a plus assez d’avis sur 7 jours pour calculer la satisfaction : ce n’est pas une amélioration.',
  seuil_modifie: 'Le seuil de l’agence a été modifié : la satisfaction n’est plus sous le nouveau seuil.',
  agence_desactivee: 'L’agence a été désactivée.',
};

export const libelleCauseFin = (cause: string | null | undefined): string | null =>
  cause && Object.prototype.hasOwnProperty.call(CAUSE_FIN_LABELS, cause) ? CAUSE_FIN_LABELS[cause as CauseFinEpisode] : null;

export const explicationCauseFin = (cause: string | null | undefined): string | null =>
  cause && Object.prototype.hasOwnProperty.call(CAUSE_FIN_EXPLICATIONS, cause) ? CAUSE_FIN_EXPLICATIONS[cause as CauseFinEpisode] : null;

// ── Épisode d'une alerte de la liste active ────────────────────────────────────────────────────────

/** Statuts d'un épisode ENCORE OUVERT, tels qu'ils figurent dans une alerte de la liste active (jamais « terminee » : une alerte terminée n'est plus dans la liste). */
export type StatutEpisodeActif = Exclude<StatutEpisode, 'terminee'>;

export interface EpisodeAlerte {
  id: string;
  statut: StatutEpisodeActif;
  detecteLe: string | null;
  debut: string | null;
  debutApproximatif: boolean;
  debutLimite: boolean;
  prisEnChargeLe: string | null;
  prisEnChargePar: string | null;
  commentaire: string | null;
}

/** Les informations d'épisode d'une alerte de seuil, ou null (ancien serveur, interrupteur coupé, épisode pas encore écrit : l'alerte s'affiche alors comme avant). */
export function episodeDeAlerte(alerte: Alerte): EpisodeAlerte | null {
  if (!alerte.episode_id) return null;
  const statut = alerte.episode_statut;
  if (statut !== 'detectee' && statut !== 'prise_en_charge') return null;
  return {
    id: alerte.episode_id,
    statut,
    detecteLe: alerte.detecte_le ?? null,
    debut: alerte.debut_condition ?? null,
    // Prudence : seul un « faux » explicite retire la mention d'approximation.
    debutApproximatif: alerte.debut_approximatif !== false,
    debutLimite: alerte.debut_remontee_limitee === true,
    prisEnChargeLe: alerte.pris_en_charge_le ?? null,
    prisEnChargePar: alerte.pris_en_charge_par_nom?.trim() || null,
    commentaire: alerte.commentaire_prise_en_charge?.trim() || null,
  };
}

/** Le bouton « Prendre en charge » : Agency Manager SEUL, sur une alerte dont l'épisode est « detectee ». Jamais pour le CX Manager. */
export const peutPrendreEnCharge = (alerte: Alerte, isAgencyManager: boolean): boolean =>
  isAgencyManager && episodeDeAlerte(alerte)?.statut === 'detectee';

/** Convention de date des alertes (relatif jusqu'à 30 jours, puis « 12 oct. 2026 »), avec « à l’instant » sous la minute (jamais « il y a 0 secondes »). */
export function dateRelativeAlerte(iso: string | Date, maintenant: Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (!Number.isNaN(d.getTime()) && Math.abs(maintenant.getTime() - d.getTime()) < 60_000) return 'à l’instant';
  return dateRelativeOuAbsolue(iso, maintenant);
}

// ── Dates : début approximatif ─────────────────────────────────────────────────────────────────────

/** « 12 oct. » (année omise si c'est l'année en cours), « 12 oct. 2025 » sinon. Vide si la date est invalide. */
export function dateJourMois(iso: string | Date, maintenant: Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return format(d, d.getFullYear() === maintenant.getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale: fr });
}

/**
 * Début d'un épisode : « Depuis environ le » (toujours, le début est reconstitué d'après les avis), « Depuis au moins le » si la reconstitution a atteint
 * sa limite (l'épisode est peut-être plus ancien), « Depuis le » seulement si le serveur affirme explicitement une date exacte.
 */
export function prefixeDebut(approximatif: boolean, limite: boolean): string {
  if (limite) return 'Depuis au moins le';
  return approximatif ? 'Depuis environ le' : 'Depuis le';
}

/**
 * Période d'un épisode pour une ligne de l'historique. Ouvert : « Depuis environ le 12 oct. » ; terminé : « Environ du 12 oct. au 15 oct. » (« Depuis au moins le
 * 12 oct., jusqu'au 15 oct. » si le début est tronqué). La fin est reconstituée comme le début : elle n'est jamais présentée comme exacte non plus.
 */
export function phraseDebutEtFin(e: PeriodeEpisode, maintenant: Date = new Date()): string {
  return segmentsPeriode(e, maintenant).map((s) => s.texte).join('');
}

export type PeriodeEpisode = Pick<EpisodeHistorique, 'debut_condition' | 'debut_approximatif' | 'debut_remontee_limitee' | 'fin_condition' | 'statut'>;

/** La même phrase en morceaux : les dates portent leur instant (`iso`) pour être rendues dans <time> avec la date complète au survol. */
export interface SegmentPeriode {
  texte: string;
  iso?: string;
}

export function segmentsPeriode(e: PeriodeEpisode, maintenant: Date = new Date()): SegmentPeriode[] {
  const debut: SegmentPeriode = { texte: dateJourMois(e.debut_condition, maintenant), iso: e.debut_condition };
  const approx = e.debut_approximatif !== false;
  if (e.statut !== 'terminee' || !e.fin_condition) return [{ texte: `${prefixeDebut(approx, e.debut_remontee_limitee)} ` }, debut];
  const fin: SegmentPeriode = { texte: dateJourMois(e.fin_condition, maintenant), iso: e.fin_condition };
  if (e.debut_remontee_limitee) return [{ texte: 'Depuis au moins le ' }, debut, { texte: ', jusqu’au ' }, fin];
  return [{ texte: approx ? 'Environ du ' : 'Du ' }, debut, { texte: ' au ' }, fin];
}

// ── Durées : jamais présentées comme certaines ─────────────────────────────────────────────────────

/** Durée arrondie, lisible : « 35 min », « 5 h », « 3 jours ». Arrondi À L'ENTIER INFÉRIEUR : on n'allonge jamais une durée. */
export function formaterDureeApprox(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${formaterNombre(m, 0)} min`;
  const heures = Math.floor(m / 60);
  if (heures < 48) return `${formaterNombre(heures, 0)} h`;
  const jours = Math.floor(heures / 24);
  return `${formaterNombre(jours, 0)} jour${jours > 1 ? 's' : ''}`;
}

export interface DureeEpisode {
  duree_minutes: number;
  duree_approximative: boolean;
  duree_minimale: boolean;
  duree_en_cours: boolean;
}

/**
 * « Durée : environ 3 jours » (terminé), « En cours depuis environ 3 jours » (ouvert), « au moins » si le début est tronqué. Sans mention d'approximation
 * seulement si le serveur dit explicitement que la durée est exacte (duree_approximative === false), ce qu'il ne fait pas aujourd'hui.
 */
export function phraseDuree(d: DureeEpisode): string {
  return d.duree_en_cours ? `En cours depuis ${valeurDuree(d)}` : `Durée : ${valeurDuree(d)}`;
}

/** « environ 3 jours », « au moins 30 jours » : la valeur seule, avec sa mention d'approximation (tiroir de détail). */
export function valeurDuree(d: DureeEpisode): string {
  const qualif = d.duree_minimale ? 'au moins ' : d.duree_approximative !== false ? 'environ ' : '';
  return `${qualif}${formaterDureeApprox(d.duree_minutes)}`;
}

/** Délai EXACT (deux instants constatés par IKAN) : « 35 minutes », « 2 h 15 min », « 1 jour 3 h ». */
export function formaterDelaiExact(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${formaterNombre(m, 0)} minute${m > 1 ? 's' : ''}`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  if (h < 24) return reste ? `${formaterNombre(h, 0)} h ${formaterNombre(reste, 0)} min` : `${formaterNombre(h, 0)} h`;
  const jours = Math.floor(h / 24);
  const heures = h % 24;
  return `${formaterNombre(jours, 0)} jour${jours > 1 ? 's' : ''}${heures ? ` ${formaterNombre(heures, 0)} h` : ''}`;
}

// ── Prise en charge : commentaire et erreurs ───────────────────────────────────────────────────────

/** Même limite que le serveur (LONGUEUR_MAX_COMMENTAIRE, après suppression des espaces de début et de fin). */
export const COMMENTAIRE_MAX = 500;
/** Le compteur devient une alerte vocale à partir de ce nombre de caractères restants. */
export const SEUIL_COMPTEUR_VOCAL = 50;

/** Espaces de début et de fin retirés ; vide = absent (comme le serveur). */
export const nettoyerCommentaire = (valeur: string): string | undefined => valeur.trim() || undefined;

export const compteurCommentaire = (valeur: string): string => `${formaterNombre(valeur.length, 0)} / ${formaterNombre(COMMENTAIRE_MAX, 0)} caractères`;

export const caracteresRestants = (valeur: string): number => COMMENTAIRE_MAX - valeur.length;

export type ClasseEchec =
  | { type: 'conflit'; message: string }      // 409 : déjà prise en charge ou terminée → rafraîchir, pas de nouvel essai
  | { type: 'introuvable'; message: string }  // 404 : l'alerte n'est plus disponible → rafraîchir
  | { type: 'reessayer'; message: string };   // le reste : message et bouton « Réessayer »

export const MESSAGE_DEJA_PRISE_EN_CHARGE = 'Cette alerte est déjà prise en charge. La liste vient d’être actualisée.';
export const MESSAGE_ALERTE_TERMINEE = 'Cette alerte est terminée : la satisfaction est repassée au-dessus du seuil, il n’y a plus rien à prendre en charge. La liste vient d’être actualisée.';
export const MESSAGE_ALERTE_INTROUVABLE = 'Cette alerte n’est plus disponible. La liste vient d’être actualisée.';
export const MESSAGE_ECHEC_PRISE_EN_CHARGE = 'La prise en charge n’a pas pu être enregistrée. Réessayez.';

/** Classe l'échec d'une prise en charge. Les messages sont ceux de l'interface (en français) ; le texte brut du serveur n'est jamais affiché tel quel. */
export function classerEchecPriseEnCharge(erreur: unknown): ClasseEchec {
  if (axios.isAxiosError(erreur)) {
    const statut = erreur.response?.status;
    if (statut === 409) {
      const detail = (erreur.response?.data as { detail?: unknown } | undefined)?.detail;
      return { type: 'conflit', message: typeof detail === 'string' && /termin/i.test(detail) ? MESSAGE_ALERTE_TERMINEE : MESSAGE_DEJA_PRISE_EN_CHARGE };
    }
    if (statut === 404) return { type: 'introuvable', message: MESSAGE_ALERTE_INTROUVABLE };
  }
  return { type: 'reessayer', message: userFacingError(erreur, MESSAGE_ECHEC_PRISE_EN_CHARGE) };
}

export type ResultatEnvoi = { type: 'succes' } | { type: 'conflit'; message: string } | { type: 'introuvable'; message: string } | { type: 'reessayer'; message: string };

/** Envoie la prise en charge (commentaire nettoyé, absent s'il est vide) et classe le résultat : la boîte de dialogue n'a plus qu'à l'afficher. Ne lève jamais. */
export async function envoyerPriseEnCharge(
  envoyer: (episodeId: string, commentaire?: string) => Promise<unknown>,
  episodeId: string,
  commentaire: string,
): Promise<ResultatEnvoi> {
  try {
    await envoyer(episodeId, nettoyerCommentaire(commentaire));
    return { type: 'succes' };
  } catch (e) {
    return classerEchecPriseEnCharge(e);
  }
}

// ── Historique : filtres et état de la liste paginée par curseur ───────────────────────────────────

export type FiltreStatut = 'tous' | StatutEpisode;
export type FiltrePeriode = 'toutes' | '7j' | '30j' | '90j';

export interface FiltresHistorique {
  statut: FiltreStatut;
  agenceId: string | null;
  periode: FiltrePeriode;
}

export const FILTRES_INITIAUX: FiltresHistorique = { statut: 'tous', agenceId: null, periode: 'toutes' };

export const OPTIONS_STATUT: Array<{ id: FiltreStatut; label: string }> = [
  { id: 'tous', label: 'Tous les états' },
  { id: 'detectee', label: 'Détectées' },
  { id: 'prise_en_charge', label: 'Prises en charge' },
  { id: 'terminee', label: 'Terminées' },
];

const JOURS_PERIODE: Record<Exclude<FiltrePeriode, 'toutes'>, number> = { '7j': 7, '30j': 30, '90j': 90 };

export const OPTIONS_PERIODE: Array<{ id: FiltrePeriode; label: string }> = [
  { id: 'toutes', label: 'Toute la période' },
  { id: '7j', label: '7 derniers jours' },
  { id: '30j', label: '30 derniers jours' },
  { id: '90j', label: '90 derniers jours' },
];

export const TAILLE_PAGE_HISTORIQUE = 20;

export const filtresActifs = (f: FiltresHistorique): boolean => f.statut !== 'tous' || f.agenceId !== null || f.periode !== 'toutes';

export interface ParametresHistorique {
  statut?: StatutEpisode;
  agence_id?: string;
  du?: string;
  limite: number;
  curseur?: string;
}

/** Paramètres de GET /alertes/episodes. La période porte sur le DÉBUT de la condition (comme le serveur) : « du » = maintenant − N jours. */
export function parametresHistorique(f: FiltresHistorique, curseur: string | null, maintenant: Date = new Date()): ParametresHistorique {
  const p: ParametresHistorique = { limite: TAILLE_PAGE_HISTORIQUE };
  if (f.statut !== 'tous') p.statut = f.statut;
  if (f.agenceId) p.agence_id = f.agenceId;
  if (f.periode !== 'toutes') p.du = new Date(maintenant.getTime() - JOURS_PERIODE[f.periode] * 86_400_000).toISOString();
  if (curseur) p.curseur = curseur;
  return p;
}

export interface EtatHistorique {
  statut: 'chargement' | 'pret' | 'erreur';
  episodes: EpisodeHistorique[];
  curseur: string | null;
  /** false : l'interrupteur serveur est coupé (ou le forfait sans alertes) : la section disparaît. */
  disponible: boolean;
  /** Au moins une réponse reçue : avant, on ne sait pas encore si la section existe. */
  charge: boolean;
  chargePlus: boolean;
  erreurPlus: boolean;
}

export const historiqueInitial: EtatHistorique = { statut: 'chargement', episodes: [], curseur: null, disponible: true, charge: false, chargePlus: false, erreurPlus: false };

export type ActionHistorique =
  | { type: 'debut' }
  | { type: 'succes'; episodes: EpisodeHistorique[]; curseur: string | null; disponible: boolean }
  | { type: 'echec' }
  | { type: 'plus_debut' }
  | { type: 'plus_succes'; episodes: EpisodeHistorique[]; curseur: string | null }
  | { type: 'plus_echec' };

export function historiqueReducer(etat: EtatHistorique, action: ActionHistorique): EtatHistorique {
  switch (action.type) {
    case 'debut':
      // Un nouveau chargement (filtre changé, actualisation) garde la liste affichée jusqu'à la réponse, sauf au tout premier chargement.
      return { ...etat, statut: 'chargement', erreurPlus: false };
    case 'succes':
      return { statut: 'pret', episodes: action.episodes, curseur: action.curseur, disponible: action.disponible, charge: true, chargePlus: false, erreurPlus: false };
    case 'echec':
      return { ...etat, statut: 'erreur', chargePlus: false };
    case 'plus_debut':
      return { ...etat, chargePlus: true, erreurPlus: false };
    case 'plus_succes': {
      const connus = new Set(etat.episodes.map((e) => e.episode_id));
      return { ...etat, episodes: [...etat.episodes, ...action.episodes.filter((e) => !connus.has(e.episode_id))], curseur: action.curseur, chargePlus: false, erreurPlus: false };
    }
    case 'plus_echec':
      return { ...etat, chargePlus: false, erreurPlus: true };
    default:
      return etat;
  }
}

/**
 * Logique pure du parcours client par QR Code (sans DOM) : testable avec `npm test`.
 * Le formulaire ([code].astro) s'appuie dessus pour : lire le code QR, valider avant envoi, construire la requête,
 * formuler les erreurs et générer la clé d'idempotence d'un envoi.
 */
import { MESSAGE_TELEPHONE_INVALIDE, normaliserTelephone } from './telephone.ts';

/** Limite du commentaire, alignée sur l'API (FeedbackCreate.commentaire, max 1000 caractères). */
export const MAX_COMMENTAIRE = 1000;

/** Délais (ms) : au-delà, on affiche une erreur récupérable plutôt qu'un bouton bloqué indéfiniment. */
export const DELAI_VALIDATION_MS = 10_000;
export const DELAI_ENVOI_MS = 20_000;

export interface NiveauSatisfaction {
  note: number;
  apiSentiment: 'negatif' | 'neutre' | 'positif';
  label: string;
}

/** Cinq niveaux, du plus mauvais au meilleur, tous au masculin (« Excellent », comme « Mauvais »). Aucun n'est présélectionné : le client choisit lui-même.
 * La clé technique « excellente » est conservée (data-sentiment, classes CSS) : seul le libellé affiché change. */
export const NIVEAUX: Record<string, NiveauSatisfaction> = {
  mauvais: { note: 1, apiSentiment: 'negatif', label: 'Mauvais' },
  passable: { note: 2, apiSentiment: 'negatif', label: 'Passable' },
  neutre: { note: 3, apiSentiment: 'neutre', label: 'Neutre' },
  bien: { note: 4, apiSentiment: 'positif', label: 'Bien' },
  excellente: { note: 5, apiSentiment: 'positif', label: 'Excellent' },
};

/**
 * Code QR de la page : paramètre ?qr= / ?code=, sinon /feedback/{code}. AUCUNE valeur par défaut : sans code, la
 * page ne doit rattacher l'avis à aucune agence (avant : repli codé en dur sur « QR-ORANGE-TUNIS-01 »).
 */
export function extraireCodeQr(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const parametre = (params.get('qr') || params.get('code') || '').trim();
  if (parametre) return parametre;
  const morceaux = pathname.split('/').filter(Boolean);
  if (morceaux.length >= 2 && morceaux[0] === 'feedback') {
    try {
      const code = decodeURIComponent(morceaux[1]).trim();
      return code || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Clé propre à UN envoi (valeurs [A-Za-z0-9_-], 8 à 64 caractères, comme l'API). Rejouée à l'identique si on réessaie. */
export function nouvelleCleEnvoi(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface EntreeEnvoi {
  niveau: string | null;
  categorieId: string | null;
  souhaiteEtreRappele: boolean;
  telephone: string;
  /** Case de consentement cochée (obligatoire dès qu'un téléphone est saisi pour être recontacté). */
  consentement?: boolean;
}

export interface ProblemeSaisie {
  champ: 'note' | 'categorie' | 'telephone' | 'consentement';
  message: string;
}

export const MESSAGE_NOTE_REQUISE = 'Choisissez une note pour envoyer votre avis.';
export const MESSAGE_CONSENTEMENT_REQUIS = "Cochez la case pour autoriser l'agence à vous recontacter.";

/**
 * Texte de la case de consentement. La durée vient de la configuration de la plateforme (champ retention_mois de
 * /qr-codes/{code}/validate), JAMAIS d'une valeur en dur ; null si elle n'est pas connue (le recontact est alors proposé nulle part).
 * ⚠ Formulation à faire valider au regard de la loi burkinabè (CIL) : voir la note de la PR.
 */
export function libelleConsentement(retentionMois: unknown): string | null {
  const mois = Number(retentionMois);
  if (!Number.isInteger(mois) || mois <= 0) return null;
  return `J'accepte que l'agence utilise mon numéro uniquement pour me recontacter au sujet de cet avis. Il sera conservé ${mois} mois.`;
}

/** « 1000 caractères restants sur 1000 », « 1 caractère restant sur 1000 » (0 et 1 au singulier, comme en français). */
export function libelleCompteur(longueur: number, max: number = MAX_COMMENTAIRE): string {
  const restants = Math.max(0, max - Math.max(0, longueur));
  return `${restants} ${restants <= 1 ? 'caractère restant' : 'caractères restants'} sur ${max}`;
}

/**
 * Navigation aux flèches dans un groupe de boutons radio (une seule tabulation d'entrée, tabindex itinérant) :
 * retourne l'index à focaliser, ou null si la touche n'est pas gérée. Les flèches déplacent le focus, Espace/Entrée choisissent.
 */
export function indexNiveauSuivant(courant: number, touche: string, total: number): number | null {
  if (total <= 0) return null;
  switch (touche) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (courant + 1) % total;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (courant - 1 + total) % total;
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}

/** Premier problème de saisie bloquant l'envoi, ou null. Ordre = ordre d'affichage du formulaire. */
export function verifierSaisie(e: EntreeEnvoi): ProblemeSaisie | null {
  if (!e.categorieId) return { champ: 'categorie', message: 'Choisissez la catégorie de votre avis.' };
  if (!e.niveau || !NIVEAUX[e.niveau]) return { champ: 'note', message: MESSAGE_NOTE_REQUISE };
  if (e.souhaiteEtreRappele) {
    const tel = e.telephone.trim();
    if (!tel) return { champ: 'telephone', message: 'Indiquez un numéro de téléphone pour être recontacté.' };
    if (!normaliserTelephone(tel)) return { champ: 'telephone', message: MESSAGE_TELEPHONE_INVALIDE };
    if (!e.consentement) return { champ: 'consentement', message: MESSAGE_CONSENTEMENT_REQUIS };
  }
  return null;
}

export interface EntreePayload extends EntreeEnvoi {
  commentaire: string;
  cleEnvoi: string;
  /** Valeur du champ piège (invisible) : vide pour une personne, rempli par un robot. */
  piege?: string;
}

/** Corps de POST /feedbacks. Le commentaire est borné ; le téléphone (et son consentement) n'est transmis que si le client demande à être rappelé. */
export function construirePayload(e: EntreePayload) {
  const niveau = NIVEAUX[e.niveau ?? ''];
  if (!niveau || !e.categorieId) throw new Error('Saisie incomplète : verifierSaisie() doit être appelée avant.');
  const commentaire = e.commentaire.trim().slice(0, MAX_COMMENTAIRE);
  return {
    categorie_id: e.categorieId,
    sentiment: niveau.apiSentiment,
    note: niveau.note,
    commentaire: commentaire || null,
    idempotency_key: e.cleEnvoi,
    souhaite_etre_rappele: e.souhaiteEtreRappele,
    contact_telephone: e.souhaiteEtreRappele ? e.telephone.trim() : null,
    consentement_contact: e.souhaiteEtreRappele && !!e.consentement,
    website: e.piege ?? '',
  };
}

export type CauseEchecEnvoi = 'reseau' | 'delai' | 'qr_invalide' | 'saisie' | 'trop_de_demandes' | 'serveur';

export function causeEchecHttp(status: number): CauseEchecEnvoi {
  if (status === 404) return 'qr_invalide';
  if (status === 429) return 'trop_de_demandes';
  if (status === 400 || status === 413 || status === 422) return 'saisie';
  return 'serveur';
}

/** Message affiché au client. L'envoi n'est JAMAIS présenté comme réussi : seul un statut 2xx confirme. */
export function messageEchecEnvoi(cause: CauseEchecEnvoi): string {
  switch (cause) {
    case 'reseau':
      return "Pas de connexion : votre avis n'a pas été envoyé. Vérifiez votre réseau puis appuyez de nouveau sur « Envoyer mon avis » (il ne sera enregistré qu'une fois).";
    case 'delai':
      return "L'envoi prend trop de temps : votre avis n'a peut-être pas été envoyé. Appuyez de nouveau sur « Envoyer mon avis » (il ne sera enregistré qu'une fois).";
    case 'qr_invalide':
      return "Ce QR code n'est plus valide, votre avis n'a pas été envoyé. Scannez de nouveau le QR code de l'agence ou signalez-le à un conseiller.";
    case 'saisie':
      return "Votre avis n'a pas pu être envoyé : vérifiez les informations saisies puis réessayez.";
    case 'trop_de_demandes':
      return "Trop de demandes en peu de temps. Patientez quelques instants puis réessayez.";
    default:
      return "Le service est momentanément indisponible, votre avis n'a pas été envoyé. Réessayez dans un instant (il ne sera enregistré qu'une fois).";
  }
}

export type EtatQr = 'valide' | 'invalide' | 'indisponible' | 'trop_de_demandes';

/** Issue de la validation du QR code : 2xx valide, 404 invalide, 429 trop de demandes, tout le reste (réseau, 5xx) indisponible. */
export function etatQrDepuisStatut(status: number | null): EtatQr {
  if (status === null) return 'indisponible';
  if (status >= 200 && status < 300) return 'valide';
  if (status === 404) return 'invalide';
  if (status === 429) return 'trop_de_demandes';
  return 'indisponible';
}

// ── « Partager une idée » : un texte, aucun contact ──────────────────────────────────

/** Taille maximale d'une idée, alignée sur l'API (SuggestionCreate.contenu, 1000 caractères). */
export const MAX_IDEE = 1000;
export const MIN_IDEE = 3;
export const MESSAGE_IDEE_VIDE = "Écrivez votre idée avant de l'envoyer.";

/** Message bloquant l'envoi d'une idée, ou null. */
export function verifierIdee(texte: string): string | null {
  return texte.trim().length < MIN_IDEE ? MESSAGE_IDEE_VIDE : null;
}

/** Corps de POST /qr-codes/{code}/suggestions : le texte (borné) et le champ piège, RIEN d'autre (aucun contact). */
export function construirePayloadIdee(texte: string, piege: string = '') {
  return { contenu: texte.trim().slice(0, MAX_IDEE), website: piege };
}

/** Message d'échec d'envoi d'une idée : jamais technique, dit que l'idée n'est pas partie ET que le texte est conservé. */
export function messageEchecIdee(cause: CauseEchecEnvoi): string {
  switch (cause) {
    case 'qr_invalide':
      return "Ce QR code n'est plus valide, votre idée n'a pas été envoyée. Merci de prévenir l'agence.";
    case 'trop_de_demandes':
      return "Trop de demandes en peu de temps : votre idée n'a pas été envoyée. Patientez une minute puis réessayez, votre texte est conservé.";
    case 'saisie':
      return "Votre idée n'a pas pu être envoyée : vérifiez le texte puis réessayez.";
    case 'reseau':
      return "Pas de connexion : votre idée n'a pas été envoyée. Votre texte est conservé, réessayez quand le réseau revient.";
    case 'delai':
      return "L'envoi prend trop de temps : votre idée n'est peut-être pas partie. Votre texte est conservé, réessayez.";
    default:
      return "Le service est momentanément indisponible, votre idée n'a pas été envoyée. Votre texte est conservé, réessayez dans un instant.";
  }
}

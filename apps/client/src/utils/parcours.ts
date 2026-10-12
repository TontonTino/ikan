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

/** Cinq niveaux, du plus mauvais au meilleur. Aucun n'est présélectionné : le client choisit lui-même. */
export const NIVEAUX: Record<string, NiveauSatisfaction> = {
  mauvais: { note: 1, apiSentiment: 'negatif', label: 'Mauvais' },
  passable: { note: 2, apiSentiment: 'negatif', label: 'Passable' },
  neutre: { note: 3, apiSentiment: 'neutre', label: 'Neutre' },
  bien: { note: 4, apiSentiment: 'positif', label: 'Bien' },
  excellente: { note: 5, apiSentiment: 'positif', label: 'Excellente' },
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
}

export interface ProblemeSaisie {
  champ: 'note' | 'categorie' | 'telephone';
  message: string;
}

/** Premier problème de saisie bloquant l'envoi, ou null. Ordre = ordre d'affichage du formulaire. */
export function verifierSaisie(e: EntreeEnvoi): ProblemeSaisie | null {
  if (!e.categorieId) return { champ: 'categorie', message: 'Choisissez la catégorie de votre avis.' };
  if (!e.niveau || !NIVEAUX[e.niveau]) return { champ: 'note', message: 'Choisissez une note pour envoyer votre avis.' };
  if (e.souhaiteEtreRappele) {
    const tel = e.telephone.trim();
    if (!tel) return { champ: 'telephone', message: 'Indiquez un numéro de téléphone pour être recontacté.' };
    if (!normaliserTelephone(tel)) return { champ: 'telephone', message: MESSAGE_TELEPHONE_INVALIDE };
  }
  return null;
}

export interface EntreePayload extends EntreeEnvoi {
  commentaire: string;
  cleEnvoi: string;
}

/** Corps de POST /feedbacks. Le commentaire est borné ; le téléphone n'est transmis que si le client demande à être rappelé. */
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
  };
}

export type CauseEchecEnvoi = 'reseau' | 'delai' | 'qr_invalide' | 'saisie' | 'trop_de_demandes' | 'serveur';

export function causeEchecHttp(status: number): CauseEchecEnvoi {
  if (status === 404) return 'qr_invalide';
  if (status === 429) return 'trop_de_demandes';
  if (status === 400 || status === 422) return 'saisie';
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

export type EtatQr = 'valide' | 'invalide' | 'indisponible';

/** Issue de la validation du QR code : 2xx valide, 404 invalide, tout le reste (réseau, 5xx) indisponible. */
export function etatQrDepuisStatut(status: number | null): EtatQr {
  if (status === null) return 'indisponible';
  if (status >= 200 && status < 300) return 'valide';
  if (status === 404) return 'invalide';
  return 'indisponible';
}

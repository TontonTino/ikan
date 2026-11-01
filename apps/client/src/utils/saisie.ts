/**
 * Mémoire de la saisie du formulaire « Noter l'expérience » (CL-04) : note, catégorie et commentaire, conservés dans le stockage
 * de SESSION du navigateur (sessionStorage : disparaît à la fermeture de l'onglet, jamais partagé entre onglets, jamais
 * localStorage) pour survivre à un rechargement de la page ou à une purge de l'onglet par le navigateur.
 *
 * Règles (testées par `npm test`) :
 *  - JAMAIS le téléphone, l'e-mail ni le consentement : seuls `niveau`, `categorieId`, `commentaire` sont écrits ;
 *  - la saisie est liée au code du QR : celle d'un autre QR n'est jamais restaurée ;
 *  - durée de vie courte : 30 minutes après la dernière modification ;
 *  - effacée après un envoi confirmé ;
 *  - si le stockage est indisponible ou lève une exception (navigation privée, stockage plein), tout continue sans mémoire,
 *    sans erreur visible : chaque accès est protégé.
 */
import { MAX_COMMENTAIRE, NIVEAUX } from './parcours.ts';
import type { IssueEnvoi } from './parcours.ts';

export const CLE_STOCKAGE = 'ikan.saisie.v1';
export const DUREE_VIE_MS = 30 * 60 * 1000;

export interface SaisieNote {
  niveau: string | null;
  categorieId: string | null;
  commentaire: string;
}

interface StockageMinimal {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

export interface OptionsMemoire {
  /** Fournit le stockage (null si indisponible). Par défaut : sessionStorage, jamais localStorage. */
  stockage?: () => StockageMinimal | null;
  /** Horloge (ms) : remplaçable par un temps simulé dans les tests. */
  maintenant?: () => number;
  dureeMs?: number;
}

function stockageSession(): StockageMinimal | null {
  try {
    return (globalThis as { sessionStorage?: StockageMinimal }).sessionStorage ?? null;
  } catch {
    return null; // l'accès lui-même peut lever une exception (cookies bloqués, navigation privée)
  }
}

const ID_CATEGORIE = /^[A-Za-z0-9_-]{1,64}$/;

export function creerMemoireSaisie(options: OptionsMemoire = {}) {
  const obtenir = options.stockage ?? stockageSession;
  const maintenant = options.maintenant ?? (() => Date.now());
  const dureeMs = options.dureeMs ?? DUREE_VIE_MS;

  function effacer(): void {
    try {
      obtenir()?.removeItem(CLE_STOCKAGE);
    } catch {
      /* stockage indisponible : rien à effacer */
    }
  }

  function ecrire(qr: string, saisie: SaisieNote): void {
    try {
      const commentaire = (saisie.commentaire ?? '').slice(0, MAX_COMMENTAIRE);
      const niveau = saisie.niveau && NIVEAUX[saisie.niveau] ? saisie.niveau : null;
      const categorieId = saisie.categorieId && ID_CATEGORIE.test(saisie.categorieId) ? saisie.categorieId : null;
      if (!niveau && !categorieId && !commentaire.trim()) {
        effacer();
        return;
      }
      // Liste blanche : aucune autre propriété de `saisie` n'est écrite (donc jamais de contact ni de consentement).
      obtenir()?.setItem(CLE_STOCKAGE, JSON.stringify({ v: 1, qr, niveau, categorieId, commentaire, ts: maintenant() }));
    } catch {
      /* stockage plein ou indisponible : le formulaire continue sans mémoire */
    }
  }

  function lire(qr: string): SaisieNote | null {
    try {
      const stockage = obtenir();
      const brut = stockage?.getItem(CLE_STOCKAGE);
      if (!brut) return null;
      const d = JSON.parse(brut);
      if (!d || d.v !== 1 || typeof d.ts !== 'number') { effacer(); return null; }
      if (maintenant() - d.ts > dureeMs || d.ts > maintenant() + 60_000) { effacer(); return null; }   // périmée (ou horodatage du futur)
      if (d.qr !== qr) return null;                                                                       // saisie d'un autre QR : jamais restaurée
      const niveau = typeof d.niveau === 'string' && NIVEAUX[d.niveau] ? d.niveau : null;
      const categorieId = typeof d.categorieId === 'string' && ID_CATEGORIE.test(d.categorieId) ? d.categorieId : null;
      const commentaire = typeof d.commentaire === 'string' ? d.commentaire.slice(0, MAX_COMMENTAIRE) : '';
      if (!niveau && !categorieId && !commentaire.trim()) return null;
      return { niveau, categorieId, commentaire };
    } catch {
      return null; // JSON corrompu ou stockage qui lève : on ignore
    }
  }

  return { lire, ecrire, effacer };
}

export type MemoireSaisie = ReturnType<typeof creerMemoireSaisie>;

/** Après un envoi : la saisie n'est effacée QUE si l'avis est confirmé (2xx). Un échec la conserve, pour réessayer sans tout ressaisir. */
export function appliquerIssue(memoire: MemoireSaisie, issue: IssueEnvoi): void {
  if (issue.type === 'succes') memoire.effacer();
}

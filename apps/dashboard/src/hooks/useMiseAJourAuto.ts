import { useEffect, useRef } from 'react';

/** Toutes les minutes tant que l'onglet est affiché : assez pour voir arriver un avis, sans charger le serveur. */
export const INTERVALLE_MISE_A_JOUR_MS = 60_000;
/** Au retour sur l'onglet, mise à jour immédiate si la dernière date d'au moins 30 secondes. */
export const DELAI_RETOUR_ONGLET_MS = 30_000;

/** Ce dont la programmation a besoin du navigateur (remplaçable dans les tests). */
export interface Environnement {
  visible: () => boolean;
  enLigne: () => boolean;
  maintenant: () => number;
  ecouterRetour: (surRetour: () => void) => () => void;
  setInterval: (f: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

const navigateur = (): Environnement => ({
  visible: () => document.visibilityState === 'visible',
  enLigne: () => navigator.onLine !== false,
  maintenant: () => Date.now(),
  ecouterRetour: (surRetour) => {
    document.addEventListener('visibilitychange', surRetour);
    window.addEventListener('focus', surRetour);
    return () => {
      document.removeEventListener('visibilitychange', surRetour);
      window.removeEventListener('focus', surRetour);
    };
  },
  setInterval: (f, ms) => window.setInterval(f, ms),
  clearInterval: (id) => window.clearInterval(id as number),
});

/** Programme les mises à jour ; renvoie la fonction d'arrêt. */
export function programmerMiseAJour(rafraichir: () => void, intervalleMs: number, env: Environnement): () => void {
  let derniere = env.maintenant();
  const peut = () => env.visible() && env.enLigne();
  const lancer = () => {
    derniere = env.maintenant();
    rafraichir();
  };
  const id = env.setInterval(() => { if (peut()) lancer(); }, intervalleMs);
  const arreterEcoute = env.ecouterRetour(() => {
    if (peut() && env.maintenant() - derniere >= DELAI_RETOUR_ONGLET_MS) lancer();
  });
  return () => {
    env.clearInterval(id);
    arreterEcoute();
  };
}

/**
 * Mise à jour automatique et silencieuse des données d'une page.
 *  - toutes les minutes, seulement si l'onglet est visible et la connexion présente (un onglet en arrière-plan ne fait rien) ;
 *  - immédiatement au retour sur l'onglet, si la dernière mise à jour date d'au moins 30 secondes.
 * `rafraichir` doit être SILENCIEUX : garder les données affichées, sans squelette ni message d'erreur s'il échoue.
 * `actif` à false suspend tout (fenêtre de traitement ouverte, saisie en cours…).
 */
export function useMiseAJourAuto(rafraichir: () => void, { actif = true, intervalleMs = INTERVALLE_MISE_A_JOUR_MS }: { actif?: boolean; intervalleMs?: number } = {}) {
  const fonction = useRef(rafraichir);
  fonction.current = rafraichir;
  useEffect(() => {
    if (!actif) return undefined;
    return programmerMiseAJour(() => fonction.current(), intervalleMs, navigateur());
  }, [actif, intervalleMs]);
}

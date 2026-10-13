import { useEffect, useState } from 'react';

/** Délai avant d'envoyer une recherche au serveur : laisse finir la frappe sans une requête par lettre. */
export const DELAI_RECHERCHE_MS = 300;

export interface FonctionDifferee<A extends unknown[]> {
  (...args: A): void;
  annuler: () => void;
}

/** Appelle `fn` une seule fois, `delaiMs` après le DERNIER appel. Chaque nouvel appel repart de zéro. */
export function creerDebounce<A extends unknown[]>(fn: (...args: A) => void, delaiMs: number): FonctionDifferee<A> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const differee = ((...args: A) => {
    if (minuteur !== undefined) clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      minuteur = undefined;
      fn(...args);
    }, delaiMs);
  }) as FonctionDifferee<A>;
  differee.annuler = () => {
    if (minuteur !== undefined) clearTimeout(minuteur);
    minuteur = undefined;
  };
  return differee;
}

/** Valeur qui ne suit `valeur` qu'après `delaiMs` sans changement (la première valeur est immédiate). */
export function useValeurDifferee<T>(valeur: T, delaiMs: number = DELAI_RECHERCHE_MS): T {
  const [differee, setDifferee] = useState(valeur);
  useEffect(() => {
    const planifier = creerDebounce(setDifferee, delaiMs);
    planifier(valeur);
    return planifier.annuler;
  }, [valeur, delaiMs]);
  return differee;
}

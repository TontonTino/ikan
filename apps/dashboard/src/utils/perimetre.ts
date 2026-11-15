import type { AgenceContexteItem } from '../types';

/**
 * Sélecteur de périmètre du menu (responsable expérience client) : « Toutes les agences » ou une agence.
 * Logique pure, testée à part : recherche insensible aux accents et à la casse, regroupement par ville, agence affichée.
 */

export const VILLE_INCONNUE = 'Ville non renseignée';

const normaliser = (texte: string) => texte.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR').trim();
const comparer = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' });

export interface GroupeVille {
  ville: string;
  agences: AgenceContexteItem[];
}

/** Agences qui correspondent à la recherche (nom OU ville), regroupées par ville ; villes et agences par ordre alphabétique. */
export function agencesParVille(agences: AgenceContexteItem[], recherche = ''): GroupeVille[] {
  const terme = normaliser(recherche);
  const groupes = new Map<string, AgenceContexteItem[]>();
  for (const agence of agences) {
    const ville = agence.ville?.trim() || VILLE_INCONNUE;
    if (terme && !normaliser(`${agence.nom} ${ville}`).includes(terme)) continue;
    groupes.set(ville, [...(groupes.get(ville) ?? []), agence]);
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (a === VILLE_INCONNUE ? 1 : b === VILLE_INCONNUE ? -1 : comparer(a, b)))
    .map(([ville, liste]) => ({ ville, agences: [...liste].sort((x, y) => comparer(x.nom, y.nom)) }));
}

/** Identifiant de l'agence affichée d'après l'adresse (« /agences/:id/apercu »), sinon null (vue réseau). */
export function agenceAffichee(chemin: string): string | null {
  const m = /^\/agences\/([^/]+)\/apercu/.exec(chemin);
  return m ? decodeURIComponent(m[1]) : null;
}

/** « 1 agence », « 11 agences ». */
export const nombreAgences = (n: number) => `${n} agence${n > 1 ? 's' : ''}`;

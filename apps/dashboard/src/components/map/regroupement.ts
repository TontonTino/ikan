/**
 * Regroupement des marqueurs proches (lot 6), sans dépendance : à l'échelle du pays, Ouagadougou et sa périphérie se
 * superposaient. Les agences sont regroupées dans l'ESPACE ÉCRAN, au zoom courant : deux marqueurs à moins de `rayon`
 * pixels l'un de l'autre forment un groupe, affiché comme une pastille avec leur nombre. Au zoom suivant, le calcul est
 * refait : un groupe se défait de lui-même quand ses agences s'écartent assez à l'écran.
 */

export interface PointEcran {
  id: string;
  /** Position en pixels au zoom courant (map.project). */
  x: number;
  y: number;
}

export interface Groupe<T extends PointEcran> {
  /** Membres dans l'ordre d'entrée ; un groupe d'un seul membre est un marqueur ordinaire. */
  membres: T[];
  /** Centre (moyenne des membres), en pixels. */
  x: number;
  y: number;
}

/** Écart à partir duquel deux marqueurs ne se gênent plus : un peu plus que la largeur d'un pin (38 px). */
export const RAYON_REGROUPEMENT_PX = 44;

/**
 * Regroupement glouton, stable : chaque point rejoint le premier groupe dont le centre est à moins de `rayon` pixels,
 * sinon il en ouvre un. Le centre du groupe suit la moyenne de ses membres. Même entrée, même résultat.
 */
export function regrouper<T extends PointEcran>(points: T[], rayon = RAYON_REGROUPEMENT_PX): Groupe<T>[] {
  const groupes: Groupe<T>[] = [];
  for (const point of points) {
    const groupe = groupes.find((g) => Math.hypot(g.x - point.x, g.y - point.y) < rayon);
    if (groupe) {
      groupe.membres.push(point);
      const n = groupe.membres.length;
      groupe.x += (point.x - groupe.x) / n;
      groupe.y += (point.y - groupe.y) / n;
    } else {
      groupes.push({ membres: [point], x: point.x, y: point.y });
    }
  }
  return groupes;
}

/**
 * Des agences aux coordonnées identiques ne se sépareront à aucun zoom : cliquer sur leur groupe ne zoome pas (inutile),
 * il en ouvre la liste.
 */
export function positionsIdentiques(positions: { latitude: number; longitude: number }[]): boolean {
  return positions.every((p) => p.latitude === positions[0].latitude && p.longitude === positions[0].longitude);
}

/** « 3 agences : 2 sous le seuil, 1 au-dessus du seuil » : le contenu du groupe en texte (title et lecteur d'écran). */
export function resumeGroupe(statuts: string[], libelles: Record<string, string>): string {
  const comptes = new Map<string, number>();
  statuts.forEach((s) => comptes.set(s, (comptes.get(s) ?? 0) + 1));
  const details = [...comptes.entries()].map(([s, n]) => `${n} ${(libelles[s] ?? s).toLowerCase()}`).join(', ');
  return `${statuts.length} agences : ${details}`;
}

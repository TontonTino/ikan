import { describe, expect, it } from 'vitest';

/**
 * Garde-fou : couples de couleurs (texte / fond) corrigés lors du Lot 1.1 (aperçu d'agence et /mon-agence).
 * Vérifie les ratios WCAG 2.1 AA (4,5:1, texte courant) ; la vérification des pages complètes a été faite
 * dans le navigateur avec axe-core (non installé comme dépendance du dépôt).
 */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [clair, fonce] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (fonce + 0.05);
};

describe('contrastes corrigés (WCAG AA, texte courant ≥ 4,5:1)', () => {
  const couples: Array<[string, string, string]> = [
    ['« Avis négatifs » de Performances clés', '#B91C1C', '#FEF2F2'],
    ['bouton « Supprimer » d’une catégorie', '#B91C1C', '#FEE2E2'],
    ['pastille de rôle d’une catégorie', '#475569', '#F1F5F9'],
    ['bouton « Marquer suggestion »', '#475569', '#F1F5F9'],
    ['statut d’avis « Action en cours »', '#92400E', '#FEF3C7'],
    ['date d’une suggestion ou d’une demande de rappel', '#64748B', '#FFFFFF'],
    ['date d’un événement d’activité', '#64748B', '#F8FAFC'],
    ['badge d’onglet urgent', '#B91C1C', '#FEE2E2'],
  ];
  it.each(couples)('%s', (_nom, texte, fond) => {
    expect(ratio(texte, fond)).toBeGreaterThanOrEqual(4.5);
  });

  it('les anciennes valeurs échouaient (le test mesure bien quelque chose)', () => {
    expect(ratio('#DC2626', '#FEF2F2')).toBeLessThan(4.5);
    expect(ratio('#94A3B8', '#FFFFFF')).toBeLessThan(4.5);
    expect(ratio('#D97706', '#FEF3C7')).toBeLessThan(4.5);
  });
});

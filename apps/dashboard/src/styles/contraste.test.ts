import { describe, expect, it } from 'vitest';
// @ts-ignore — pas de types Node dans ce projet ; le test lit les jetons réels du CSS.
import { readFileSync } from 'node:fs';

/** Contraste WCAG 2.1 (luminance relative). */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const tokens: string = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const jeton = (nom: string) => {
  const m = tokens.match(new RegExp(`${nom}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`jeton introuvable : ${nom}`);
  return m[1];
};

describe('contrastes corrigés au Lot 6 (WCAG 2.1 AA : 4,5:1 pour le texte)', () => {
  it('fil d’Ariane « IKAN AI » (texte secondaire sur le fond de la page)', () => {
    expect(ratio(jeton('--color-text-muted'), jeton('--color-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#94A3B8', jeton('--color-bg'))).toBeLessThan(4.5); // l’ancienne couleur échouait
  });

  it('libellés de la page de gestion des agences (texte secondaire sur blanc)', () => {
    expect(ratio(jeton('--color-text-muted'), jeton('--color-surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('badge « Négatif » / erreur de la veille (texte critique sur fond critique)', () => {
    expect(ratio(jeton('--color-critical-text'), jeton('--color-critical-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#DC2626', jeton('--color-critical-bg'))).toBeLessThan(4.5); // l’ancienne couleur échouait
  });
});

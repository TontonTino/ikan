import { describe, expect, it } from 'vitest';
// @ts-ignore — pas de types Node dans ce projet ; le test lit les jetons réels du CSS.
import { readFileSync } from 'node:fs';

/*
 * Contrastes WCAG 2.1 de la palette (lot 2a), calculés sur les VRAIES valeurs de tokens.css (alias var() suivis).
 * Seuils : 4,5:1 pour tout texte ; 3:1 pour les bordures de contrôles, les icônes et l'anneau de focus.
 * Ce test doit échouer si quelqu'un baisse un contraste plus tard : il ne liste que des couples réellement utilisés.
 */

/** Contraste WCAG 2.1 (luminance relative). */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const tokens: string = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** Valeur hexadécimale d'un jeton, en suivant les alias `var(--autre)`. */
const jeton = (nom: string, profondeur = 0): string => {
  if (profondeur > 8) throw new Error(`alias circulaire : ${nom}`);
  const m = tokens.match(new RegExp(`${nom}:\\s*([^;]+);`));
  if (!m) throw new Error(`jeton introuvable : ${nom}`);
  const valeur = m[1].trim();
  const alias = valeur.match(/^var\((--[\w-]+)\)$/);
  if (alias) return jeton(alias[1], profondeur + 1);
  if (!/^#[0-9A-Fa-f]{6}$/.test(valeur)) throw new Error(`${nom} n'est pas une couleur hexadécimale : ${valeur}`);
  return valeur.toUpperCase();
};

const TEXTE = 4.5;
const GRAPHIQUE = 3;
const BLANC = '#FFFFFF';

describe('palette : chaque texte contre chacun de ses fonds (≥ 4,5:1)', () => {
  const fonds = ['--color-surface', '--color-bg'];
  const textes = ['--color-encre', '--color-text-2', '--color-accent', '--color-marque'];
  for (const texte of textes) {
    for (const fond of fonds) {
      it(`${texte} sur ${fond}`, () => expect(ratio(jeton(texte), jeton(fond))).toBeGreaterThanOrEqual(TEXTE));
    }
  }

  it('texte blanc sur un bouton d’accent, au repos et au survol', () => {
    expect(ratio(BLANC, jeton('--color-accent'))).toBeGreaterThanOrEqual(TEXTE);
    expect(ratio(BLANC, jeton('--color-accent-hover'))).toBeGreaterThanOrEqual(TEXTE);
  });

  it('texte blanc et texte de la sidebar sur l’encre', () => {
    expect(ratio(BLANC, jeton('--color-encre'))).toBeGreaterThanOrEqual(TEXTE);
    expect(ratio(jeton('--sidebar-text'), jeton('--color-encre'))).toBeGreaterThanOrEqual(TEXTE);
    expect(ratio(jeton('--color-text-on-dark-muted'), jeton('--color-encre'))).toBeGreaterThanOrEqual(TEXTE);
  });

  it('texte principal et secondaire sur un élément sélectionné', () => {
    expect(ratio(jeton('--color-encre'), jeton('--color-active-item'))).toBeGreaterThanOrEqual(TEXTE);
    expect(ratio(jeton('--color-text-2'), jeton('--color-active-item'))).toBeGreaterThanOrEqual(TEXTE);
  });
});

describe('statuts : chaque texte sur son fond, et sur blanc (≥ 4,5:1)', () => {
  for (const statut of ['bon', 'surveiller', 'critique', 'neutre']) {
    it(statut, () => {
      expect(ratio(jeton(`--color-${statut}-texte`), jeton(`--color-${statut}-fond`))).toBeGreaterThanOrEqual(TEXTE);
      expect(ratio(jeton(`--color-${statut}-texte`), BLANC)).toBeGreaterThanOrEqual(TEXTE);
    });
  }

  it('les quatre statuts restent distincts (aucune paire texte/fond identique)', () => {
    const paires = ['bon', 'surveiller', 'critique', 'neutre'].map((s) => `${jeton(`--color-${s}-texte`)}/${jeton(`--color-${s}-fond`)}`);
    expect(new Set(paires).size).toBe(4);
  });

  it('les anciens noms de statut (-text, -bg) pointent sur la palette de statuts', () => {
    expect(jeton('--color-success-text')).toBe(jeton('--color-bon-texte'));
    expect(jeton('--color-warning-text')).toBe(jeton('--color-surveiller-texte'));
    expect(jeton('--color-critical-text')).toBe(jeton('--color-critique-texte'));
    expect(jeton('--color-critical-bg')).toBe(jeton('--color-critique-fond'));
  });
});

describe('éléments graphiques (≥ 3:1)', () => {
  it('bordures de champs et de boutons, sur blanc et sur crème', () => {
    expect(ratio(jeton('--color-border'), BLANC)).toBeGreaterThanOrEqual(GRAPHIQUE);
    expect(ratio(jeton('--color-border'), jeton('--color-bg'))).toBeGreaterThanOrEqual(GRAPHIQUE);
  });

  it('anneau de focus (accent) sur blanc et sur crème', () => {
    expect(tokens).toMatch(/--focus-ring:[^;]*var\(--color-accent\)/);
    expect(ratio(jeton('--color-accent'), BLANC)).toBeGreaterThanOrEqual(GRAPHIQUE);
    expect(ratio(jeton('--color-accent'), jeton('--color-bg'))).toBeGreaterThanOrEqual(GRAPHIQUE);
  });

  it('icônes et traits en accent vif, sur blanc et sur crème', () => {
    expect(ratio(jeton('--color-accent-vif'), BLANC)).toBeGreaterThanOrEqual(GRAPHIQUE);
    expect(ratio(jeton('--color-accent-vif'), jeton('--color-bg'))).toBeGreaterThanOrEqual(GRAPHIQUE);
  });

  it('séries de graphique qui portent du sens, sur blanc', () => {
    for (const serie of ['--dataviz-positive', '--dataviz-critical', '--dataviz-attention', '--dataviz-info', '--dataviz-neutral']) {
      expect(ratio(jeton(serie), BLANC), serie).toBeGreaterThanOrEqual(GRAPHIQUE);
    }
  });
});

describe('couleurs interdites en texte : la règle est écrite et les valeurs le justifient', () => {
  it('citron et accent vif échouent à 4,5:1 sur blanc : jamais de texte', () => {
    expect(ratio(jeton('--color-citron'), BLANC)).toBeLessThan(TEXTE);
    expect(ratio(jeton('--color-accent-vif'), BLANC)).toBeLessThan(TEXTE);
    expect(tokens).toMatch(/--color-citron:[^\n]*jamais de texte/);
    expect(tokens).toMatch(/--color-accent-vif:[^\n]*jamais de texte/);
  });

  it('le citron ne sert jamais de série porteuse de sens (1,74:1 sur blanc)', () => {
    for (const serie of ['--dataviz-positive', '--dataviz-critical', '--dataviz-attention', '--dataviz-info', '--dataviz-neutral']) {
      expect(jeton(serie), serie).not.toBe(jeton('--color-citron'));
    }
  });

  it('l’accent du deck (#C94A26) échoue en lien sur la crème : la variante conforme est utilisée', () => {
    expect(ratio('#C94A26', jeton('--color-bg'))).toBeLessThan(TEXTE);
    expect(jeton('--color-accent')).not.toBe('#C94A26');
  });
});

describe('typographie (lot 2a)', () => {
  const px = (nom: string) => {
    const m = tokens.match(new RegExp(`${nom}:\\s*([\\d.]+)rem`));
    if (!m) throw new Error(`taille introuvable : ${nom}`);
    return parseFloat(m[1]) * 16;
  };

  it('échelle 12 / 14 / 15 / 18 / 22 / 28 px, et plus rien sous 12 px', () => {
    expect(['--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl'].map(px)).toEqual([12, 14, 15, 18, 22, 28]);
    expect(tokens).not.toMatch(/--text-2xs/);
  });

  it('deux graisses seulement : 400 et 600', () => {
    const graisses = [...tokens.matchAll(/--weight-[\w-]+:\s*(\d{3})/g)].map((m) => m[1]);
    expect(new Set(graisses)).toEqual(new Set(['400', '600']));
    const faces = [...tokens.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => m[1]);
    expect(faces.sort()).toEqual(['400', '600']);
  });

  it('Poppins auto-hébergée : aucun appel à Google Fonts', () => {
    const global: string = readFileSync(new URL('./global.css', import.meta.url), 'utf8');
    expect(tokens + global).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(tokens).toMatch(/--font-main:\s*'Poppins'/);
    expect(tokens).toMatch(/url\('\/fonts\/poppins-latin-400-normal\.woff2'\)/);
    expect(tokens).toMatch(/url\('\/fonts\/poppins-latin-600-normal\.woff2'\)/);
  });
});

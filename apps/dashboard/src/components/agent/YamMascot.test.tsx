import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import YamMascot, { type YamEtat, type YamVariante } from './YamMascot';

const ETATS: YamEtat[] = ['accueil', 'reflexion', 'alerte', 'resolu'];
const VARIANTES: YamVariante[] = ['corps', 'tete'];
const cadre = (html: string) => {
  const [x, y, l, h] = /viewBox="([^"]+)"/.exec(html)![1].split(' ').map(Number);
  return { gauche: x, haut: y, droite: x + l, bas: y + h };
};
const ids = (html: string) => [...html.matchAll(/<radialGradient id="([^"]+)"/g)].map((m) => m[1]);

describe('YamMascot', () => {
  it.each(ETATS.flatMap((e) => VARIANTES.map((v) => [e, v] as const)))('rend l’état %s, variante %s', (state, variant) => {
    const html = renderToStaticMarkup(<YamMascot state={state} variant={variant} />);
    expect(html.startsWith('<svg')).toBe(true);
    expect(html).toContain(`data-yam-state="${state}"`);
    expect(html).toContain(`data-yam-variant="${variant}"`);
    expect(html).toContain('<path d="M60 22 C86 22'); // le tronc validé
    expect(html).not.toContain('<text');
    expect(html).not.toContain('<title');
  });

  it('défauts : accueil, corps, 96 px de haut', () => {
    const html = renderToStaticMarkup(<YamMascot />);
    expect(html).toContain('data-yam-state="accueil"');
    expect(html).toContain('viewBox="0 -4 120 144"');
    expect(html).toContain('height="96"');
    expect(renderToStaticMarkup(<YamMascot variant="tete" />)).toContain('viewBox="18 -4 104 100"');
  });

  it('la hauteur règle la taille et la largeur suit le cadre', () => {
    const html = renderToStaticMarkup(<YamMascot size={36} />);
    expect(html).toContain('height="36"');
    expect(html).toContain('width="30"');
  });

  it('sans title : décoratif (aria-hidden), sans role ni aria-label', () => {
    const html = renderToStaticMarkup(<YamMascot />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role=');
    expect(html).not.toContain('aria-label');
  });

  it('avec title : role="img" et aria-label, sans aria-hidden', () => {
    const html = renderToStaticMarkup(<YamMascot title="YAM, l’assistant" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="YAM, l’assistant"');
    expect(html).not.toContain('aria-hidden');
  });

  it('deux instances affichées ensemble ont deux identifiants de dégradé différents, chacun utilisé par son tronc', () => {
    const html = renderToStaticMarkup(<><YamMascot /><YamMascot state="alerte" /></>);
    const [a, b] = ids(html);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(html).toContain(`fill="url(#${a})"`);
    expect(html).toContain(`fill="url(#${b})"`);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);   // utilisable dans url(#…)
  });

  it('les états portent leurs éléments propres', () => {
    const rendu = (s: YamEtat) => renderToStaticMarkup(<YamMascot state={s} />);
    expect(rendu('accueil')).toContain('M52 80 Q60 87 68 80');
    expect(rendu('reflexion')).toContain('cx="116" cy="14"');
    expect(rendu('alerte')).toContain('#d6452d');
    expect(rendu('alerte')).not.toContain('#f4a58a');        // pas de joues en alerte
    expect(rendu('resolu')).toContain('M91.5 30 L96.5 35 L105 24');
    expect(rendu('accueil')).toContain('#f4a58a');
  });

  it('variante tête : le cadre couvre toute la scène de réflexion (3e pastille à x = 116, r = 4, donc jusqu’à x = 120)', () => {
    const html = renderToStaticMarkup(<YamMascot state="reflexion" variant="tete" />);
    expect(cadre(html).droite).toBeGreaterThanOrEqual(120);
    expect(html).toContain('cx="116" cy="14"');
  });

  it.each(ETATS)('variante tête, état %s : aucun cercle (pastille, badge) n’est coupé par le cadre', (state) => {
    const html = renderToStaticMarkup(<YamMascot state={state} variant="tete" />);
    const c = cadre(html);
    const cercles = [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], r: +m[3] }));
    for (const { x, y, r } of cercles) {
      expect(x - r).toBeGreaterThanOrEqual(c.gauche);
      expect(x + r).toBeLessThanOrEqual(c.droite);
      expect(y - r).toBeGreaterThanOrEqual(c.haut);
      expect(y + r).toBeLessThanOrEqual(c.bas);
    }
    if (state !== 'accueil') expect(cercles.length).toBeGreaterThan(0);
  });

  it('la largeur suit le cadre de la tête (hauteur = size)', () => {
    const html = renderToStaticMarkup(<YamMascot variant="tete" size={56} />);
    expect(html).toContain('height="56"');
    expect(html).toContain('width="58.24"');
  });

  it('la variante tête ne dessine ni ombre, ni bras, ni jambes', () => {
    const tete = renderToStaticMarkup(<YamMascot variant="tete" />);
    expect(tete).not.toContain('rotate(');
    expect(tete).not.toContain('<rect');
    expect(renderToStaticMarkup(<YamMascot />)).toContain('rotate(8 24 86)');
  });
});

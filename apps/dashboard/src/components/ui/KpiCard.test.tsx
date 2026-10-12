import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import KpiCard from './KpiCard';

const base = { icon: <span />, label: 'Satisfaction', value: '40 %' };

describe('KpiCard — un seul élément interactif par carte', () => {
  it('carte cliquable avec aide : le bouton d’action et l’aide sont frères, jamais imbriqués', () => {
    const html = renderToStaticMarkup(<KpiCard {...base} hint="Part des avis notés 4 ou 5" onClick={() => undefined} />);
    expect(html.match(/<button/g)).toHaveLength(2);                       // action + aide
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/s); // aucun bouton dans un bouton
    expect(html).not.toContain('role="button"');                          // la carte n’est plus un faux bouton
    expect(html).toContain('aria-label="Satisfaction : 40 %. Voir le détail"');
    expect(html).toContain('aria-label="À propos : Satisfaction"');
  });

  it('carte non cliquable : aucun bouton d’action', () => {
    const html = renderToStaticMarkup(<KpiCard {...base} />);
    expect(html).not.toContain('ui-kpi__action');
    expect(html).not.toContain('<button');
  });

  it('carte cliquable sans aide : un seul bouton', () => {
    const html = renderToStaticMarkup(<KpiCard {...base} onClick={() => undefined} />);
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

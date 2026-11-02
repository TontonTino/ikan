import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AideAlertes, { AIDE_ALERTES_TITRE, ouvertApresClic, ouvertApresTouche } from './AideAlertes';

describe('aide « Comment lire cette page »', () => {
  it('fermée par défaut : un bouton discret, aucun panneau, aria-expanded="false"', () => {
    const html = renderToStaticMarkup(<AideAlertes />);
    expect(html).toContain(`>${AIDE_ALERTES_TITRE}</button>`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('ui-alert');
  });

  it('ouverte : aria-expanded="true", aria-controls pointe le panneau, contenu de l’ancien encadré + phrase de l’en-tête', () => {
    const html = renderToStaticMarkup(<AideAlertes ouvertInitial />);
    expect(html).toContain('aria-expanded="true"');
    const controles = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controles).toBeTruthy();
    expect(html).toContain(`id="${controles}"`);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('disparaissent d’elles-mêmes quand la situation redevient normale');
    expect(html).toContain('Une alerte signale une situation ; elle ne crée pas de problème à traiter');
  });

  it('Échap ferme, les autres touches non', () => {
    expect(ouvertApresTouche(true, 'Escape')).toBe(false);
    expect(ouvertApresTouche(true, 'Tab')).toBe(true);
    expect(ouvertApresTouche(true, 'Enter')).toBe(true);
    expect(ouvertApresTouche(false, 'Escape')).toBe(false);
  });

  it('un clic extérieur ferme, un clic dans le bouton ou le panneau non', () => {
    expect(ouvertApresClic(true, false)).toBe(false);
    expect(ouvertApresClic(true, true)).toBe(true);
  });
});

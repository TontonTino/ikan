import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-ignore — pas de types Node dans ce projet (même convention que styles/contraste.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import CubeIkan from './CubeIkan';
import sourceMenu from '../layout/Sidebar.tsx?raw';

const css: string = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('filigrane du cube dans le menu', () => {
  it('cube vectoriel décoratif, d’une seule couleur', () => {
    const html = renderToStaticMarkup(<CubeIkan className="x" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('viewBox="0 0 253 289"');
  });

  it('seulement pour les responsables (expérience client et agence), pas pour l’admin', () => {
    expect(sourceMenu).toContain("(user?.role === 'cx_manager' || user?.role === 'agency_manager') && <CubeIkan className=\"dashboard-sidebar__filigrane\" />");
  });

  it('plus sombre que le fond (encre translucide) : le contraste des textes n’est jamais réduit ; derrière le contenu, masqué replié', () => {
    const regle = /\.dashboard-sidebar__filigrane \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regle).toContain('color: var(--color-encre)');
    expect(regle).toContain('z-index: -1');
    expect(regle).toContain('pointer-events: none');
    expect(css).toContain('.dashboard-sidebar--collapsed .dashboard-sidebar__filigrane { display: none; }');
  });
});

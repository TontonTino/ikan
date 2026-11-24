import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EntreeDemo from './EntreeDemo';
import { BUILD_DEMO, chargerRolesDemo, rolesProposes } from '../services/demo';

const rendu = (roles: Parameters<typeof EntreeDemo>[0]['roles']) =>
  renderToStaticMarkup(<EntreeDemo roles={roles} onEntrer={async () => {}} />);

describe('démonstration publique', () => {
  it('hors démo, rien n’est affiché sur la page de connexion', () => {
    expect(rendu([])).toBe('');
  });

  it('un bouton par rôle proposé, dans un ordre fixe, sans jamais l’Admin', () => {
    expect(rolesProposes(['agency_manager', 'admin', 'cx_manager', 'inconnu'])).toEqual(['cx_manager', 'agency_manager']);
    expect(rolesProposes(undefined)).toEqual([]);
    const html = rendu(['cx_manager', 'agency_manager']);
    expect(html.indexOf('Responsable expérience client')).toBeLessThan(html.indexOf('Responsable d’agence'));
    expect(html.match(/data-role=/g)).toHaveLength(2);
    expect(html).toContain('remise à zéro chaque nuit');
    expect(html).toContain('ou avec votre compte');
  });

  it('les boutons ne soumettent jamais le formulaire de connexion', () => {
    expect(rendu(['cx_manager'])).toMatch(/<button type="button" class="entree-demo__bouton"/);
  });

  it('le build normal n’interroge jamais la route de démo', async () => {
    expect(BUILD_DEMO).toBe(false);
    await expect(chargerRolesDemo()).resolves.toEqual([]);
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import ParametresPage from './ParametresPage';

const rendu = (role: 'cx_manager' | 'agency_manager') => {
  useAuthStore.setState({
    user: { id: 'u1', nom: 'Mansour', prenom: 'Leila', email: 'leila@exemple.tn', role, organisation_id: 'o1', delai_alerte_negatif_heures: 24 } as never,
  } as never);
  return renderToStaticMarkup(<ParametresPage />);
};

const champs = (html: string) => [...html.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
const etiquettes = (html: string) => [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);

describe('Paramètres du compte — libellés des champs', () => {
  it.each(['cx_manager', 'agency_manager'] as const)('chaque champ est relié à son libellé (%s)', (role) => {
    const html = rendu(role);
    const ids = champs(html);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    // chaque <label for> désigne un champ existant, et chaque champ a son libellé
    for (const cible of etiquettes(html)) expect(ids).toContain(cible);
    for (const id of ids) expect(etiquettes(html)).toContain(id);
  });

  it('identifiants uniques', () => {
    const ids = champs(rendu('cx_manager'));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GestionAgencesPage from './GestionAgencesPage';
import sourceRepertoire from './AdminAgencesContent.tsx?raw';

// Le répertoire utilise `window` à l'import (carte, éditeur de position) : il est simulé pour le rendu serveur ; son texte est contrôlé sur la SOURCE.
const etat = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));
vi.mock('./AdminAgencesContent', () => ({ default: () => <h2>Répertoire des agences (3)</h2> }));
vi.mock('./AdminUsersContent', () => ({ default: () => <p>contenu comptes</p> }));

const rendu = (role: 'cx_manager' | 'admin') => {
  etat.user = { id: 'u1', nom: 'N', prenom: 'P', email: 'u@test.io', role, organisation_id: 'o1' };
  return renderToStaticMarkup(
    <StaticRouter location="/admin/gestion-agences">
      <GestionAgencesPage />
    </StaticRouter>,
  );
};

const occurrences = (texte: string, motif: string) => texte.split(motif).length - 1;

beforeEach(() => { etat.user = null; });

describe('Gestion des agences (CX Manager) : un seul titre de page, une seule phrase', () => {
  it('titre de page et sous-titre conservés, une seule fois, suivis du répertoire', () => {
    const html = rendu('cx_manager');
    expect(occurrences(html, '<h1')).toBe(1);
    expect(html).toContain('<h1 class="ui-page-title__h1">Gestion des agences</h1>');
    expect(occurrences(html, 'Agences, QR codes et responsables d’agence de votre réseau.')).toBe(1);
    expect(html.indexOf('Gestion des agences')).toBeLessThan(html.indexOf('Répertoire des agences (3)'));
  });

  it('le répertoire garde son intitulé de section avec son compteur, sans la phrase qui dupliquait le sous-titre', () => {
    expect(sourceRepertoire).toContain('Répertoire des agences ({agences.length})');
    expect(sourceRepertoire).not.toContain('Agences, QR codes et responsables d’agence du réseau');
    expect(sourceRepertoire).not.toMatch(/Agences, QR codes et responsables/);
  });

  it('les fonctions du répertoire sont inchangées (actions et recherche)', () => {
    expect(sourceRepertoire).toContain('Ajouter un responsable d’agence');
    expect(sourceRepertoire).toContain('Nouvelle agence');
    expect(sourceRepertoire).toContain('Rechercher par agence, ville, adresse ou responsable');
  });

  it('vue Administrateur inchangée : ni titre ajouté, ni répertoire', () => {
    const html = rendu('admin');
    expect(html).not.toContain('<h1');
    expect(html).toContain('contenu comptes');
    expect(html).not.toContain('Répertoire des agences');
  });
});

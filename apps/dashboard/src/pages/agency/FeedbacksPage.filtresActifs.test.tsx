// CX-04 : la page « Avis du réseau » affiche les filtres actifs (venus du lien) et un bouton « Retirer le filtre … » pour chacun.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types';
import FeedbacksPage from './FeedbacksPage';

const etat = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));

const AGENCE = '6f1a0000-0000-4000-8000-0000000000aa';
const utilisateur = (role: User['role']): User =>
  ({ id: 'u1', nom: 'N', prenom: 'P', email: 'u@test.io', role, organisation_id: 'o1', agence_id: role === 'agency_manager' ? 'a1' : null, agence_nom: null } as unknown as User);

const rendu = (role: User['role'], location: string, props: { agenceId?: string } = {}) => {
  etat.user = utilisateur(role);
  return renderToStaticMarkup(<StaticRouter location={location}><FeedbacksPage {...props} /></StaticRouter>);
};

beforeEach(() => { etat.user = null; });

describe('page « Avis du réseau » avec des filtres venus du lien', () => {
  const lien = `/feedbacks?jours=30&theme=attente&agence=${AGENCE}`;

  it('affiche chaque filtre actif, lisible, avec son bouton de retrait nommé', () => {
    const html = rendu('cx_manager', lien);
    expect(html).toContain('aria-label="Filtres actifs"');
    for (const libelle of ['Période : 30 derniers jours', 'Thème : Attente &amp; Délais en caisse', 'Agence : Sélectionnée']) {
      expect(html).toContain(`aria-label="Retirer le filtre ${libelle}"`);
    }
    expect((html.match(/aria-label="Retirer le filtre /g) || []).length).toBe(3);
    expect(html).toContain('Tout réinitialiser');
  });

  it('sans filtre : ni récapitulatif ni bouton de retrait ni « Tout réinitialiser »', () => {
    const html = rendu('cx_manager', '/feedbacks');
    expect(html).not.toContain('aria-label="Filtres actifs"');
    expect(html).not.toContain('Retirer le filtre');
    expect(html).not.toContain('Tout réinitialiser');
  });

  it('un seul filtre : un seul bouton de retrait', () => {
    const html = rendu('cx_manager', '/feedbacks?jours=7');
    expect((html.match(/aria-label="Retirer le filtre /g) || []).length).toBe(1);
    expect(html).toContain('Retirer le filtre Période : 7 derniers jours');
  });

  it('le total annonce que la liste est filtrée', () => {
    expect(rendu('cx_manager', lien)).toContain('Recherche en cours');          // état initial ; « correspondant aux critères » suit la réponse
  });

  it('l’agence imposée par la page (page agence) n’est pas un filtre retirable', () => {
    const html = rendu('cx_manager', '/feedbacks?jours=30', { agenceId: AGENCE });
    expect(html).not.toContain('Retirer le filtre Agence');
    expect(html).toContain('Retirer le filtre Période : 30 derniers jours');
  });

  it('un identifiant d’agence invalide dans le lien est ignoré', () => {
    expect(rendu('cx_manager', '/feedbacks?agence=pas-un-uuid')).not.toContain('Retirer le filtre Agence');
  });
});

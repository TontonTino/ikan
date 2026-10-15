import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types';
import FeedbacksPage from './FeedbacksPage';

// En rendu serveur, le magasin zustand renvoie son état INITIAL (pas setState) : on le remplace par un état contrôlé.
const etat = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));

const utilisateur = (role: User['role']): User =>
  ({ id: 'u1', nom: 'N', prenom: 'P', email: 'u@test.io', role, organisation_id: 'o1', agence_id: role === 'agency_manager' ? 'a1' : null, agence_nom: role === 'agency_manager' ? 'Agence A1' : null } as unknown as User);

const rendu = (role: User['role'], location = '/feedbacks') => {
  etat.user = utilisateur(role);
  return renderToStaticMarkup(
    <StaticRouter location={location}>
      <FeedbacksPage />
    </StaticRouter>,
  );
};

beforeEach(() => { etat.user = null; });

describe('page « Avis du réseau » (CX Manager, /feedbacks)', () => {
  it('offre le filtre par agence, le filtre « avis contradictoires » et les filtres existants', () => {
    const html = rendu('cx_manager');
    expect(html).toContain('aria-label="Filtrer par agence"');
    expect(html).toContain('Toutes les agences');
    expect(html).toContain('aria-label="Filtrer les avis contradictoires"');
    expect(html).toContain('Avis contradictoires uniquement');
    for (const filtre of ['Filtrer par période', 'Filtrer par note', 'Filtrer par ton', 'Filtrer par gravité', 'Filtrer par thème']) {
      expect(html).toContain(`aria-label="${filtre}"`);
    }
    expect(html).toContain('Rechercher dans le texte des avis');
  });

  it('indique ce que veut dire « contradictoire » et à partir de quel forfait la détection existe', () => {
    const html = rendu('cx_manager');
    expect(html).toContain('la note et le ton du texte se contredisent');
    expect(html).toContain('à partir du forfait Pro');
  });

  it('état initial : chargement annoncé, ni liste vide ni erreur (les états vide et erreur sont ceux d’EtatListeAvis)', () => {
    const html = rendu('cx_manager');
    expect(html).toContain('Chargement des avis');
    expect(html).not.toContain('Aucun avis ne correspond');
    expect(html).not.toContain('Impossible de charger');
  });

  it('le responsable d’agence réutilise la même liste, sans sélecteur d’agence', () => {
    const html = rendu('agency_manager');
    expect(html).toContain('aria-label="Filtrer les avis contradictoires"');
    expect(html).not.toContain('aria-label="Filtrer par agence"');
  });
});

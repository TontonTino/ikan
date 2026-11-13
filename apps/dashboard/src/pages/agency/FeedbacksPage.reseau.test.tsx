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

  it('indique ce que veut dire « contradictoire », sans mention commerciale sur l’écran de travail', () => {
    const html = rendu('cx_manager');
    expect(html).toContain('la note et le ton du texte se contredisent');
    expect(html).not.toMatch(/forfait/i);
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

describe('liste dense (lot 3) : une ligne par avis', () => {
  it('la date et le thème passent en métadonnées : plus de colonnes « Date » ni « Thème »', () => {
    for (const role of ['agency_manager', 'cx_manager'] as const) {
      const entetes = [...rendu(role).matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
      expect(entetes).toEqual(['Note et ton', 'Avis', 'Statut', 'Action']);
    }
  });

  it('une seule phrase d’explication sous les onglets, et plus d’onglet « À surveiller »', () => {
    const html = rendu('cx_manager');
    expect(html).not.toContain('À surveiller');
    expect((html.match(/« À traiter » :/g) || []).length).toBe(1);
  });

  it('filtres repliés par défaut, dépliés quand un filtre arrive par le lien', () => {
    expect(rendu('cx_manager')).not.toMatch(/<details[^>]*open/);
    expect(rendu('cx_manager', '/feedbacks?theme=attente')).toMatch(/<details[^>]*open/);
  });
});

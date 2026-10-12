import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Suggestion } from '../../types';
import PilotageIdeasTab from './PilotageIdeasTab';

const idee = (id: string, contenu: string): Suggestion => ({ id, contenu, statut: 'nouveau', date_soumission: '2026-10-10T10:00:00Z' } as Suggestion);

const rendu = (surcharge: Partial<React.ComponentProps<typeof PilotageIdeasTab>> = {}) =>
  renderToStaticMarkup(
    <PilotageIdeasTab
      suggestions={[]}
      suggestionsTotal={0}
      suggestionsLoading={false}
      suggestionsLoadingMore={false}
      suggestionsError={false}
      onRetrySuggestions={vi.fn()}
      loadMoreSuggestions={vi.fn()}
      updateStatut={vi.fn()}
      activeSubTab="toutes"
      setActiveSubTab={vi.fn()}
      {...surcharge}
    />,
  );

describe('suggestions — les cinq états', () => {
  it('chargement : indicateur accessible, ni liste ni message vide', () => {
    const html = rendu({ suggestionsLoading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement des suggestions');
    expect(html).not.toContain('Aucune suggestion');
  });

  it('succès sans résultat : véritable état vide', () => {
    const html = rendu();
    expect(html).toContain('Aucune suggestion pour le moment');
    expect(html).not.toContain('Impossible de charger');
  });

  it('succès avec résultats : les suggestions sont affichées', () => {
    const html = rendu({ suggestions: [idee('a', 'Ouvrir le samedi'), idee('b', 'Plus de caisses')], suggestionsTotal: 2 });
    expect(html).toContain('Ouvrir le samedi');
    expect(html).toContain('Plus de caisses');
    expect(html).not.toContain('Aucune suggestion');
  });

  it('erreur de chargement : message d’erreur et réessai, JAMAIS « Aucune suggestion »', () => {
    const html = rendu({ suggestionsError: true });
    expect(html).toContain('Impossible de charger les suggestions');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Aucune suggestion');
  });

  it('erreur de chargement : aucun détail technique affiché', () => {
    const html = rendu({ suggestionsError: true });
    expect(html).not.toMatch(/Error|500|Network|axios|undefined/);
  });

  it('erreur d’actualisation avec données déjà chargées : les données restent visibles', () => {
    const html = rendu({ suggestionsError: true, suggestions: [idee('a', 'Ouvrir le samedi')], suggestionsTotal: 1 });
    expect(html).toContain('Ouvrir le samedi');
    expect(html).toContain('Réessayer');
  });

  it('onglet sans suggestion alors que d’autres existent : message de catégorie, pas de faux vide global', () => {
    const html = rendu({ suggestions: [idee('a', 'Ouvrir le samedi')], suggestionsTotal: 1, activeSubTab: 'decisions' });
    expect(html).toContain('Aucune suggestion dans cette catégorie.');
    expect(html).not.toContain('Aucune suggestion pour le moment');
  });
});

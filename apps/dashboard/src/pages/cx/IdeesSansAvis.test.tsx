import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PilotageIdeasTab from './PilotageIdeasTab';
import type { Suggestion } from '../../types';

const HOSTILE = '<script>alert("x")</script><img src=x onerror=alert(1)> & "guillemets"';

const idee = (extra: Partial<Suggestion> = {}): Suggestion => ({
  id: 'sugg-1',
  feedback_id: null, // idée envoyée seule, sans avis
  agence_id: 'agence-1',
  contenu: 'Ajouter une rampe d’accès.',
  statut: 'nouveau',
  date_soumission: '2026-10-12T10:00:00Z',
  ...extra,
});

const rendu = (suggestions: Suggestion[]) =>
  renderToStaticMarkup(
    <PilotageIdeasTab
      suggestions={suggestions}
      suggestionsTotal={suggestions.length}
      suggestionsLoading={false}
      suggestionsLoadingMore={false}
      suggestionsError={false}
      onRetrySuggestions={vi.fn()}
      loadMoreSuggestions={vi.fn()}
      updateStatut={vi.fn()}
      activeSubTab="toutes"
      setActiveSubTab={vi.fn()}
    />,
  );

describe('Suggestions — idées envoyées sans avis', () => {
  it('affiche une idée sans feedback avec son statut « Nouveau »', () => {
    const out = rendu([idee()]);
    expect(out).toContain('Ajouter une rampe d’accès.');
    expect(out).toContain('Nouveau');
  });

  it('affiche un texte hostile comme du TEXTE : balises échappées, aucun élément injecté', () => {
    const out = rendu([idee({ contenu: HOSTILE })]);
    expect(out).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<script>alert');
    expect(out).not.toMatch(/<img[^>]*onerror/);
  });
});

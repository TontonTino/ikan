import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatsErrorState } from './StatsStates';

describe('StatsErrorState — état d’erreur distinct de l’état vide', () => {
  it('est annoncé aux technologies d’assistance et ne parle pas d’« analyses » hors statistiques', () => {
    const html = renderToStaticMarkup(<StatsErrorState message="Impossible de charger les demandes de rappel." onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Impossible de charger ces informations');
    expect(html).not.toContain('analyses');
    expect(html).toContain('Impossible de charger les demandes de rappel.');
    expect(html).toContain('Réessayer');
  });

  it('un titre propre à l’écran peut être fourni ; sans nouvelle tentative, pas de bouton', () => {
    const html = renderToStaticMarkup(<StatsErrorState title="Statistiques indisponibles" message="Réessayez plus tard." />);
    expect(html).toContain('Statistiques indisponibles');
    expect(html).not.toContain('Réessayer');
  });
});

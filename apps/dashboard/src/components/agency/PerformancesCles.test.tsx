import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StatsAgenceResponse } from '../../types';
import PerformancesCles from './PerformancesCles';

const stats = {
  kpis: { satisfaction: { valeur: '38.9%' } },
  sentiments: [{ sentiment: 'positif', count: 27 }, { sentiment: 'negatif', count: 31 }],
} as unknown as StatsAgenceResponse;

const rendu = (props: Partial<React.ComponentProps<typeof PerformancesCles>>) =>
  renderToStaticMarkup(<PerformancesCles stats={null} erreur={false} onRetry={vi.fn()} {...props} />);

describe('Performances clés de l’agence — états', () => {
  it('chargement : indicateur accessible', () => {
    const html = rendu({});
    expect(html).toContain('Chargement…');
    expect(html).toContain('aria-busy="true"');
  });

  it('erreur : message et réessai, pas de chargement infini', () => {
    const html = rendu({ erreur: true });
    expect(html).toContain('Impossible de charger les performances');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Chargement…');
  });

  it('données : satisfaction, avis positifs et négatifs réels', () => {
    const html = rendu({ stats });
    expect(html).toContain('38.9%');
    expect(html).toContain('>27<');
    expect(html).toContain('>31<');
    expect(html).toContain('Avis négatifs');
  });

  it('données déjà chargées : une erreur ultérieure ne les efface pas', () => {
    const html = rendu({ stats, erreur: true });
    expect(html).toContain('38.9%');
    expect(html).not.toContain('Impossible de charger');
  });

  it('satisfaction absente : tiret, jamais 0', () => {
    const html = rendu({ stats: { kpis: {}, sentiments: [] } as unknown as StatsAgenceResponse });
    expect(html).toContain('>—<');
  });
});

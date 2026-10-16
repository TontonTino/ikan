import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ThemeStatsDetail } from '../../types';
import { ThemeAgences, ThemeTonGravite, ThemeVerbatim } from './ThemeInfos';

const theme = (extra: Partial<ThemeStatsDetail> = {}): ThemeStatsDetail => ({
  theme: 'accueil', label: 'Accueil', count: 10, pourcentage: 50, sentiment_predominant: 'negatif', ...extra,
});
const rendu = (element: React.ReactElement) => renderToStaticMarkup(element);

describe('onglet Thèmes de la page Avis : informations rétablies', () => {
  it('agences concernées : singulier, pluriel, absent', () => {
    expect(rendu(<ThemeAgences theme={theme({ agences_concernees: 1 })} />)).toContain('1 agence concernée<');
    expect(rendu(<ThemeAgences theme={theme({ agences_concernees: 3 })} />)).toContain('3 agences concernées');
    expect(rendu(<ThemeAgences theme={theme()} />)).toBe('');
  });

  it('gravité la plus fréquente en français, ou « Aucune gravité disponible »', () => {
    expect(rendu(<ThemeTonGravite theme={theme({ gravite_frequente: 'elevee' })} />)).toContain('Gravité la plus fréquente : élevée');
    expect(rendu(<ThemeTonGravite theme={theme({ gravite_frequente: 'critique' })} />)).toContain('Gravité la plus fréquente : critique');
    expect(rendu(<ThemeTonGravite theme={theme({ gravite_frequente: null })} />)).toContain('Aucune gravité disponible');
    expect(rendu(<ThemeTonGravite theme={theme()} />)).toContain('Ton dominant : négatif');
  });

  it('extrait : le plus récent, entre guillemets ; rien si aucun commentaire', () => {
    expect(rendu(<ThemeVerbatim theme={theme({ verbatims: ['le plus récent', 'plus ancien'] })} />)).toContain('&quot;le plus récent&quot;');
    expect(rendu(<ThemeVerbatim theme={theme({ verbatims: ['le plus récent', 'plus ancien'] })} />)).not.toContain('plus ancien');
    expect(rendu(<ThemeVerbatim theme={theme({ verbatims: [] })} />)).toBe('');
    expect(rendu(<ThemeVerbatim theme={theme()} />)).toBe('');
  });
});

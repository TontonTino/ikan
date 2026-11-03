import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InsightIADetail } from '../../types';
import AiInsightsSummary from './AiInsightsSummary';
import { EtiquetteJour } from '../veille/VeilleDailyChart';
import { jourComplet } from '../../utils/dateJour';

const insight = (s: Partial<InsightIADetail> = {}): InsightIADetail => ({
  id: 'i1', type: 'recommandation', titre: 'Recommandation automatique', description: 'URGENT — Les temps d’attente sont signalés comme inacceptables.',
  priorite: 'critical', agence_nom: 'Agence A1', source: 'regle' as InsightIADetail['source'], ...s,
});

describe('page Statistiques : le préfixe « URGENT — » n’est pas affiché sur la carte de recommandation', () => {
  it('retiré à l’affichage, le reste du texte est intact', () => {
    const html = renderToStaticMarkup(<AiInsightsSummary insights={[insight()]} />);
    expect(html).not.toContain('URGENT');
    expect(html).toContain('Les temps d’attente sont signalés comme inacceptables.');
  });

  it('la donnée n’est pas modifiée', () => {
    const donnee = insight();
    renderToStaticMarkup(<AiInsightsSummary insights={[donnee]} />);
    expect(donnee.description).toBe('URGENT — Les temps d’attente sont signalés comme inacceptables.');
  });

  it('les autres constats (points forts, vigilance) ne sont pas réécrits', () => {
    const html = renderToStaticMarkup(<AiInsightsSummary insights={[insight({ type: 'point_vigilance', titre: 'Point de vigilance', description: 'URGENT — texte du constat' })]} />);
    expect(html).toContain('URGENT — texte du constat');
  });

  it('un « urgent » au milieu du texte reste affiché', () => {
    expect(renderToStaticMarkup(<AiInsightsSummary insights={[insight({ description: 'Situation URGENT — à suivre.' })]} />)).toContain('Situation URGENT — à suivre.');
  });
});

describe('Veille : l’infobulle du graphique journalier n’affiche jamais une date ISO brute', () => {
  const aujourdhui = new Date();
  const iso = (jours: number) => {
    const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() - jours);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('récent : relatif, dans <time> avec la date complète au survol', () => {
    const html = renderToStaticMarkup(<EtiquetteJour jour={iso(5)} />);
    expect(html).toContain('il y a 5 jours');
    expect(html).toContain(`dateTime="${iso(5)}"`);
    expect(html).toContain(`title="${jourComplet(iso(5))}"`);
    expect(html.replace(/dateTime="[^"]*"/, '')).not.toMatch(/\d{4}-\d{2}-\d{2}/);       // l'ISO n'est qu'un attribut machine, jamais du texte
  });

  it('hier et aujourd’hui', () => {
    expect(renderToStaticMarkup(<EtiquetteJour jour={iso(0)} />)).toContain('Aujourd’hui');
    expect(renderToStaticMarkup(<EtiquetteJour jour={iso(1)} />)).toContain('Hier');
  });

  it('ancien : « 12 oct. 2025 » (absolu)', () => {
    const html = renderToStaticMarkup(<EtiquetteJour jour="2024-10-12" />);
    expect(html).toContain('>12 oct. 2024</time>');
    expect(html).toContain('title="12 octobre 2024"');
  });
});

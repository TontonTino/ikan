// CX-01 : valeurs, libellés, évolutions et états vides des quatre indicateurs de la vue siège (rendu de SiegeKpis).
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { StatsCXResponse, StatKPI } from '../../../types';
import { SiegeKpis } from './SiegeBlocks';
import type { AlertesSiege } from './siegeData';
import type { Source } from './useSiegeData';

const kpi = (valeur_num: number | null, valeur_precedente: number | null): StatKPI =>
  ({ status: valeur_num == null ? 'no_data' : 'ok', valeur: valeur_num, valeur_num, valeur_precedente, evolution: null, is_positive: true } as StatKPI);

const stats = (k: Record<string, StatKPI>): Source<StatsCXResponse> =>
  ({ status: 'ok', data: { kpis: k, evolution_satisfaction: [], sentiments: [] } as unknown as StatsCXResponse });

const alertes: Source<AlertesSiege> = { status: 'ok', data: { items: [], incluses: true, sousSeuil: [] } };

const rendu = (s: Source<StatsCXResponse>, jours = 30) =>
  renderToStaticMarkup(
    <StaticRouter location="/siege">
      <SiegeKpis stats={s} alertes={alertes} nbAgences={2} jours={jours} onOpen={vi.fn()} />
    </StaticRouter>,
  );

describe('vue siège : valeurs des indicateurs (jeu de l’API : 8 avis, CSAT 50 %, 2 critiques)', () => {
  const html = rendu(stats({ satisfaction: kpi(50, 75), total_feedbacks: kpi(8, 4), alertes_critiques: kpi(2, 1) }));

  it('libellés, valeurs et nombre d’avis', () => {
    for (const libelle of ['Satisfaction', 'Avis reçus', 'Avis critiques', 'Agences sous leur seuil']) expect(html).toContain(libelle);
    expect(html).toContain('50 %');
    expect(html).toMatch(/>8</);
    expect(html).toMatch(/>2</);
    expect(html).toContain('sur 2 agences');
  });

  it('évolutions : points pour le CSAT, pourcentage pour les avis, compte absolu pour les critiques, base de comparaison dite', () => {
    expect(html).toContain('−25 pts');
    expect(html).toContain('+100 %');
    expect(html).toContain('+1');
    expect(html).toContain('vs 30 derniers jours précédents');
  });

  it('le CSAT en baisse est défavorable et les avis critiques en hausse aussi (flèches distinctes, pas seulement la couleur)', () => {
    expect((html.match(/ui-kpi__delta--down/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('ui-kpi__delta--up');
  });
});

describe('vue siège : états vides', () => {
  it('aucun avis : « Pas d’avis », 0 avis, aucune évolution ni « 0 % »', () => {
    const html = rendu(stats({ satisfaction: kpi(null, null), total_feedbacks: kpi(0, 0), alertes_critiques: kpi(0, 0) }));
    expect(html).toMatch(/Pas d(&#x27;|')avis/);
    expect(html).not.toContain('0 %');
    expect(html).not.toContain('ui-kpi__delta');
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).toContain('30 derniers jours');
  });

  it('avis cette période mais aucun avant : pas de comparaison, dit pourquoi', () => {
    const html = rendu(stats({ satisfaction: kpi(50, null), total_feedbacks: kpi(8, 0), alertes_critiques: kpi(2, 0) }));
    expect(html).toContain('Pas de comparaison : aucun avis sur la période précédente');
    expect(html).not.toContain('ui-kpi__delta');
  });

  it('période de 12 mois : libellé « 12 derniers mois »', () => {
    expect(rendu(stats({ satisfaction: kpi(null, null), total_feedbacks: kpi(0, 0), alertes_critiques: kpi(0, 0) }), 365)).toContain('12 derniers mois');
  });

  it('grands nombres au format français (séparateur de milliers) et virgule décimale', () => {
    const html = rendu(stats({ satisfaction: kpi(61.5, 60), total_feedbacks: kpi(1234, 1000), alertes_critiques: kpi(12, 10) }));
    expect(html).toMatch(/1[\s  ]234/);
    expect(html).toContain('61,5 %');
  });

  it('statistiques indisponibles : tiret et message, jamais une valeur inventée', () => {
    const html = rendu({ status: 'error' });
    expect(html).toContain('Statistiques indisponibles');
    expect(html).not.toContain('0 %');
  });
});

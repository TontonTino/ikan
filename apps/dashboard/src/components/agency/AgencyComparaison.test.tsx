import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ComparaisonPeriode, DashboardAgence, StatKPI } from '../../types';
import AgencyDecisionKpis from './AgencyDecisionKpis';

const rendu = (data: DashboardAgence, jours = 30) =>
  renderToStaticMarkup(<StaticRouter location="/agence"><AgencyDecisionKpis data={data} jours={jours} /></StaticRouter>);

const kpi = (surcharge: Partial<StatKPI>): StatKPI => ({ status: 'ok', valeur: 0, valeur_num: 0, valeur_precedente: null, evolution: null, is_positive: true, ...surcharge });

const comparaison = (precedent: number, satisfaction: Partial<StatKPI>, total: Partial<StatKPI>): ComparaisonPeriode => ({
  jours: 30, nombre_feedbacks_precedent: precedent, satisfaction: kpi(satisfaction), total_feedbacks: kpi(total),
});

const dashboard = (surcharge: Partial<DashboardAgence> = {}): DashboardAgence => ({
  agence_id: 'a1', agence_nom: 'Agence', periode: '30 derniers jours', taux_satisfaction: 66.7, nombre_feedbacks: 3, nombre_negatifs: 1, nombre_critiques: 0,
  nombre_suggestions: 0, feedbacks_a_traiter: 3, taux_prise_en_charge: 0, actions_ouvertes: 0, tendances: [], themes: [], sentiments: [], discordances: 0, ...surcharge,
});

describe('vue d’ensemble : évolution par rapport à la période précédente', () => {
  it('hausse de la satisfaction et du volume : flèche + signe + valeur + base de comparaison', () => {
    const html = rendu(dashboard({ comparaison: comparaison(2, { evolution: '+16.7 pts', is_positive: true }, { evolution: '+50.0%', is_positive: true }) }));
    expect(html).toContain('+16,7 pts');
    expect(html).toContain('+50,0 %');
    expect(html).toContain('ui-kpi__delta--up');
    expect((html.match(/ui-kpi__delta[^"]*"><svg/g) || []).length).toBe(2);              // une flèche par évolution, pas seulement la couleur
    expect(html).toContain('vs 2 avis sur les 30 jours précédents');
    expect(html).toContain('évolution favorable');
    expect(html).not.toContain('Pas de données avant');
  });

  it('baisse défavorable : signe moins, valeur, mention accessible', () => {
    const html = rendu(dashboard({ comparaison: comparaison(5, { evolution: '-12.3 pts', is_positive: false }, { evolution: '-40.0%', is_positive: false }) }));
    expect(html).toContain('−12,3 pts');
    expect(html).toContain('−40,0 %');
    expect(html).toContain('ui-kpi__delta--down');
    expect(html).toContain('évolution défavorable');
  });

  it('période précédente sans avis : « Pas de données avant », ni flèche, ni 0, ni NaN', () => {
    const html = rendu(dashboard({ comparaison: comparaison(0, { evolution: null, valeur_precedente: null }, { evolution: null, valeur_precedente: 0 }) }));
    expect(html).toContain('Pas de données avant');
    expect(html).not.toContain('ui-kpi__delta');
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).not.toMatch(/[+−]0[,.]0/);
  });

  it('un seul avis avant : la base de comparaison est dite (« vs 1 avis »)', () => {
    const html = rendu(dashboard({ nombre_feedbacks: 1, taux_satisfaction: 0, comparaison: comparaison(1, { evolution: '-100.0 pts', is_positive: false }, { evolution: '+0.0%' }) }));
    expect(html).toContain('−100,0 pts');
    expect(html).toContain('vs 1 avis sur les 30 jours précédents');   // singulier
    expect(html).toContain('stable');
  });

  it('aucun avis cette période mais des avis avant : « Aucune donnée » pour la satisfaction, baisse de volume réelle', () => {
    const html = rendu(dashboard({
      taux_satisfaction: null, nombre_feedbacks: 0, nombre_negatifs: 0,
      comparaison: comparaison(3, { status: 'no_data', valeur: null, valeur_num: null }, { evolution: '-100.0%', is_positive: false }),
    }));
    expect(html).toContain('Aucune donnée');
    expect(html).toContain('−100,0 %');
    expect(html).not.toContain('Pas de données avant');
  });

  it('« avis » est invariable : jamais « aviss » (défaut présent avant cette PR sur la carte Satisfaction)', () => {
    const html = rendu(dashboard({ nombre_feedbacks: 72 }));
    expect(html).toContain('sur 72 avis');
    expect(html).not.toContain('aviss');
  });

  it('ancien serveur sans comparaison : aucune comparaison inventée, aucune phrase d’excuse', () => {
    const html = rendu(dashboard());
    expect(html).not.toMatch(/vs |précédent|Pas de données avant|ui-kpi__delta/);
    expect(html).not.toContain('Aucune comparaison');
  });
});

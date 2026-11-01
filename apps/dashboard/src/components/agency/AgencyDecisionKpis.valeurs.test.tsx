// AM-02 : valeurs et libellés des indicateurs de l'agence (CSAT, nombre d'avis, critiques, à traiter) et ordre de lecture de la page.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ComparaisonPeriode, DashboardAgence, StatKPI } from '../../types';
import AgencyDecisionKpis from './AgencyDecisionKpis';
import sourcePage from '../../pages/agency/DashboardAgencePage.tsx?raw';

const rendu = (data: DashboardAgence, jours = 30) =>
  renderToStaticMarkup(<StaticRouter location="/agence"><AgencyDecisionKpis data={data} jours={jours} /></StaticRouter>);

const kpi = (s: Partial<StatKPI>): StatKPI => ({ status: 'ok', valeur: 0, valeur_num: 0, valeur_precedente: null, evolution: null, is_positive: true, ...s });
const comparaison = (precedent: number, satisfaction: Partial<StatKPI>, total: Partial<StatKPI>): ComparaisonPeriode =>
  ({ jours: 30, nombre_feedbacks_precedent: precedent, satisfaction: kpi(satisfaction), total_feedbacks: kpi(total) });

// Valeurs de l'API pour l'agence A1 du jeu de tests (tests/test_am02_indicateurs_agence.py).
const A1: DashboardAgence = {
  agence_id: 'a1', agence_nom: 'Agence A1', periode: '30 derniers jours', taux_satisfaction: 50, nombre_feedbacks: 6, nombre_negatifs: 3, nombre_critiques: 2,
  nombre_suggestions: 0, feedbacks_a_traiter: 5, taux_prise_en_charge: 33.3, actions_ouvertes: 0, tendances: [], themes: [], sentiments: [], discordances: 1,
  comparaison: comparaison(3, { valeur_num: 50, valeur_precedente: 66.7, evolution: '-16.7 pts', is_positive: false }, { valeur: 6, valeur_precedente: 3, evolution: '+100.0%', is_positive: true }),
} as DashboardAgence;

describe('indicateurs de l’agence : valeurs affichées', () => {
  const html = rendu(A1);
  it('CSAT, nombre d’avis, avis critiques et avis à traiter', () => {
    for (const libelle of ['Satisfaction', 'Avis reçus', 'Avis critiques', 'Avis à traiter']) expect(html).toContain(libelle);
    expect(html).toContain('50 %');
    expect(html).toMatch(/>6</);
    expect(html).toMatch(/>2</);
    expect(html).toMatch(/>5</);
  });
  it('contexte : période, nombre d’avis, négatifs, prise en charge', () => {
    expect(html).toContain('sur 6 avis · 30 derniers jours');
    expect(html).toContain('3 négatifs');
    expect(html).toContain('33.3 % pris en charge');
  });
  it('évolution par rapport à la période précédente : points pour le CSAT, % pour le volume, base dite', () => {
    expect(html).toContain('−16,7 pts');
    expect(html).toMatch(/\+100,0[\s  ]%/);                         // espace avant « % » : insécable ou fine selon le moteur
    expect(html).toContain('vs 3 avis sur les 30 jours précédents');
  });
  it('la durée de la période suit le sélecteur', () => {
    expect(rendu(A1, 7)).toContain('sur 6 avis · 7 derniers jours');
    expect(rendu(A1, 90)).toContain('90 derniers jours');
  });
});

describe('indicateurs de l’agence : formatage et cas vides', () => {
  it('singulier et grands nombres au format français', () => {
    const html = rendu({ ...A1, nombre_feedbacks: 1234, nombre_negatifs: 1, taux_satisfaction: 61 } as DashboardAgence);
    expect(html).toMatch(/1[\s  ]234/);
    expect(html).toContain('1 négatif');
    expect(html).not.toContain('1 négatifs');
  });

  // DÉFAUT CONNU (présentation, non corrigé par cette PR de tests) : le CSAT et la prise en charge de la vue agence s'écrivent avec un POINT
  // décimal (« 61.5 % », « 33.3 % pris en charge »), alors que leurs évolutions (« −16,7 pts ») et la vue siège (« 61,5 % ») utilisent la
  // virgule française. `it.fails` réussit tant que le défaut existe et ÉCHOUERA une fois corrigé : retirer alors `.fails`.
  it.fails('CSAT et prise en charge avec la virgule décimale française', () => {
    const html = rendu({ ...A1, taux_satisfaction: 61.5, taux_prise_en_charge: 33.3 } as DashboardAgence);
    expect(html).toContain('61,5 %');
    expect(html).toContain('33,3 % pris en charge');
  });
  it('aucun avis : « Aucune donnée », jamais 0 % ni NaN', () => {
    const html = rendu({ ...A1, nombre_feedbacks: 0, taux_satisfaction: null, nombre_negatifs: 0, nombre_critiques: 0, feedbacks_a_traiter: 0, taux_prise_en_charge: null,
      comparaison: comparaison(0, { status: 'no_data', valeur: null, valeur_num: null }, { valeur: 0, valeur_precedente: 0 }) } as DashboardAgence);
    expect(html).toContain('Aucune donnée');
    expect(html).toContain('aucun avis sur les 30 derniers jours');
    expect(html).toContain('prise en charge : aucune donnée');
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).not.toContain('0 %');
  });
  it('avis critiques : ton critique seulement s’il y en a', () => {
    expect(rendu(A1)).toContain('ui-kpi--critical');
    expect(rendu({ ...A1, nombre_critiques: 0 } as DashboardAgence)).not.toContain('ui-kpi--critical');
  });
});

describe('ordre de lecture de la vue d’ensemble : situation, puis priorités, puis évolution, puis détail', () => {
  // Garde-fou statique : l'ordre des blocs dans le JSX est l'ordre du DOM et du clavier. Le rendu visuel reste à vérifier à l'œil.
  const source = sourcePage.replace(/\r\n/g, '\n');
  const position = (motif: string) => {
    const i = source.indexOf(motif, source.indexOf('return ('));
    expect(i, motif).toBeGreaterThan(-1);
    return i;
  };
  it('AgencyDecisionKpis < AgencyPriorities < AgencyEvolution < Ton et thèmes < Recommandations < Problèmes', () => {
    const ordre = ['<AgencyDecisionKpis', '<AgencyPriorities', '<AgencyEvolution', '<TonDesAvis', '<ThemesDesAvis', '<AgencyRecommendations', '<AgencyProblemes'].map(position);
    expect(ordre).toEqual([...ordre].sort((a, b) => a - b));
  });
});

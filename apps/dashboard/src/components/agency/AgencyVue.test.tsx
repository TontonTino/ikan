import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DashboardAgence, Recommandation } from '../../types';
import AgencyPriorities, { PRIORITES_VISIBLES, resumePriorites } from './AgencyPriorities';
import AgencyRecommendations, { RECOMMANDATIONS_VISIBLES } from './AgencyRecommendations';
import AgencyProblemes from './AgencyProblemes';
import AgencyDecisionKpis from './AgencyDecisionKpis';
import { TonDesAvis, ThemesDesAvis } from './AgencyClients';
import { TableauEvolution } from './AgencyEvolution';
import type { Priorite } from './agenceVue';

const rendu = (el: React.ReactElement) => renderToStaticMarkup(<StaticRouter location="/agence">{el}</StaticRouter>);

const priorite = (i: number, ton: Priorite['ton'] = 'warning', kind: Priorite['kind'] = 'avis'): Priorite => ({
  id: `p${i}`, kind, ton, type: kind === 'seuil' ? 'Alerte de seuil' : kind === 'probleme' ? 'Problème à traiter' : 'Avis à examiner',
  titre: `Titre ${i}`, detail: `Détail ${i}`, lien: { to: '/feedbacks?tab=critiques', label: 'Examiner' },
});
const reco = (i: number, priorite: Recommandation['priorite'] = 'high'): Recommandation =>
  ({ id: `r${i}`, analyse_ia_id: 'x', contenu: `Contenu reco ${i}`, priorite, date_generation: '2026-10-10T10:00:00Z', traitee: false, source: 'regle' });

const propsPrio = (surcharge = {}) => ({ priorites: [] as Priorite[], loading: false, alertesIndisponibles: false, problemesIndisponibles: false, avisATraiter: 3, onRetry: vi.fn(), ...surcharge });

describe('priorités — états', () => {
  it('chargement : squelette, pas de message « aucune priorité »', () => {
    const html = rendu(<AgencyPriorities {...propsPrio({ loading: true })} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Aucune priorité');
  });

  it('aucune priorité et sources disponibles : véritable état vide', () => {
    const html = rendu(<AgencyPriorities {...propsPrio()} />);
    expect(html).toContain('Aucune priorité détectée');
  });

  it('alertes ET problèmes indisponibles : erreur avec réessai, jamais « aucune priorité »', () => {
    const html = rendu(<AgencyPriorities {...propsPrio({ alertesIndisponibles: true, problemesIndisponibles: true })} />);
    expect(html).toContain('Impossible de vérifier');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Aucune priorité détectée');
  });

  it('une seule source indisponible : signal partiel, pas de faux « tout va bien »', () => {
    const html = rendu(<AgencyPriorities {...propsPrio({ alertesIndisponibles: true })} />);
    expect(html).toContain('Non vérifié : les alertes');
    expect(html).not.toContain('Aucune priorité détectée');
    expect(html).toContain('Aucun signal dans les données vérifiées');
  });

  it('au plus quatre priorités visibles, les autres sont annoncées et dépliables', () => {
    const html = rendu(<AgencyPriorities {...propsPrio({ priorites: Array.from({ length: 9 }, (_, i) => priorite(i)) })} />);
    expect((html.match(/agence-prio__item /g) || []).length).toBe(PRIORITES_VISIBLES);
    expect(html).toContain('Afficher les 5 autres priorités');
    expect(html).toContain('aria-expanded="false"');
  });

  it('peu de priorités : aucun bouton de dépliage', () => {
    const html = rendu(<AgencyPriorities {...propsPrio({ priorites: [priorite(1), priorite(2)] })} />);
    expect(html).not.toContain('autres priorité');
  });

  it('chaque priorité a un lien réel et le type est écrit (pas seulement la couleur)', () => {
    const html = rendu(<AgencyPriorities {...propsPrio({ priorites: [priorite(1, 'critical', 'seuil')] })} />);
    expect(html).toContain('href="/feedbacks?tab=critiques"');
    expect(html).toContain('Alerte de seuil');
  });

  it('le lien vers les avis à traiter porte le bon nombre, sa période et la bonne destination', () => {
    const html = rendu(<AgencyPriorities {...propsPrio({ avisATraiter: 72, periode: '30 derniers jours' })} />);
    expect(html).toContain('72 avis à traiter (30 derniers jours)');
    expect(html).toContain('href="/feedbacks?tab=a_traiter"');
    expect(html).toContain('72 avis à traiter');
    expect(html).toContain('href="/alertes"');
  });

  it('rappelle qu’une alerte, un avis et un problème sont distincts', () => {
    expect(rendu(<AgencyPriorities {...propsPrio()} />)).toMatch(/ne crée pas automatiquement l’autre|l’un ne crée pas/);
  });

  it('résumé : décompte par type', () => {
    expect(resumePriorites([priorite(1, 'critical', 'seuil'), priorite(2, 'warning', 'probleme'), priorite(3), priorite(4)])).toBe('1 alerte de seuil · 1 problème à traiter · 2 avis à examiner');
  });
});

const propsReco = (surcharge = {}) => ({ recos: [] as Recommandation[], total: 0, loadFailed: false, loading: false, loadingMore: false, actionsEnCours: 2, onMarquerTraitee: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn(), ...surcharge });

describe('recommandations — états', () => {
  it('erreur sans donnée : message et réessai, pas d’état vide', () => {
    const html = rendu(<AgencyRecommendations {...propsReco({ loadFailed: true })} />);
    expect(html).toContain('Impossible de charger les recommandations');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Aucune recommandation en attente');
  });

  it('succès sans recommandation : vrai état vide, sans prétendre que tout est résolu', () => {
    const html = rendu(<AgencyRecommendations {...propsReco()} />);
    expect(html).toContain('Aucune recommandation en attente');
    expect(html).toContain('ne confirme pas');
  });

  it('48 recommandations : trois seulement sont affichées, triées par priorité', () => {
    const recos = [...Array.from({ length: 45 }, (_, i) => reco(i, 'low')), reco(100, 'critical'), reco(101, 'critical'), reco(102, 'high')];
    const html = rendu(<AgencyRecommendations {...propsReco({ recos, total: 48 })} />);
    expect((html.match(/agence-reco"/g) || []).length).toBe(RECOMMANDATIONS_VISIBLES);
    expect(html).toContain('Contenu reco 100');
    expect(html).not.toContain('Contenu reco 5<');
    expect(html).toContain('Voir les 45 autres');
    expect(html).toContain('Recommandations en attente (48)');
  });

  it('distingue recommandation et action exécutée', () => {
    const html = rendu(<AgencyRecommendations {...propsReco({ recos: [reco(1)], total: 1 })} />);
    expect(html).toContain('n’est pas une action exécutée');
    expect(html).toContain('En attente');
    expect(html).toContain('href="/actions"');
    expect(html).toContain('2 actions à mener en cours');
  });

  it('plus de recommandations côté serveur : bouton de chargement avec le décompte', () => {
    const html = rendu(<AgencyRecommendations {...propsReco({ recos: [reco(1), reco(2)], total: 68 })} />);
    expect(html).toContain('Charger les suivantes (2/68)');
  });

  it('échec d’actualisation avec données : la liste reste affichée', () => {
    const html = rendu(<AgencyRecommendations {...propsReco({ recos: [reco(1)], total: 1, loadFailed: true })} />);
    expect(html).toContain('Contenu reco 1');
    expect(html).toContain('n’ont pas pu être actualisées');
  });
});

describe('suivi des problèmes', () => {
  const totals = { ouverte: 2, action_en_cours: 1, reouverte: 0, resolue: 4, verifiee: 1 };
  it('affiche les totaux réels', () => {
    const html = rendu(<AgencyProblemes snapshot={{ items: [], totals, truncated: false }} failed={false} onRetry={vi.fn()} />);
    expect(html).toContain('Encore à traiter');
    expect(html).toMatch(/Encore à traiter<\/dt><dd>3</);
    expect(html).toMatch(/Résolus<\/dt><dd>4</);
  });
  it('erreur : message et réessai, pas de zéros trompeurs', () => {
    const html = rendu(<AgencyProblemes snapshot={null} failed onRetry={vi.fn()} />);
    expect(html).toContain('indisponible');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('agence-stat');
  });
});

const dashboard = (surcharge: Partial<DashboardAgence> = {}): DashboardAgence => ({
  agence_id: 'a1', agence_nom: 'Agence', periode: '30 derniers jours', taux_satisfaction: 40, nombre_feedbacks: 72, nombre_negatifs: 31, nombre_critiques: 30,
  nombre_suggestions: 2, feedbacks_a_traiter: 72, taux_prise_en_charge: 5.6, actions_ouvertes: 1, tendances: [], themes: [], sentiments: [], discordances: 0, ...surcharge,
});

describe('indicateurs et analyses', () => {
  it('quatre indicateurs seulement, avec leur période', () => {
    const html = rendu(<AgencyDecisionKpis data={dashboard()} jours={30} />);
    expect((html.match(/ui-kpi /g) || []).length).toBe(4);
    expect(html).toContain('30 derniers jours');
    expect(html).toContain('5.6 % pris en charge');
  });

  it('aucun avis : « Aucune donnée », pas de 0 % trompeur', () => {
    const html = rendu(<AgencyDecisionKpis data={dashboard({ taux_satisfaction: null, nombre_feedbacks: 0, nombre_negatifs: 0 })} jours={7} />);
    expect(html).toContain('Aucune donnée');
    expect(html).not.toContain('0 %<');
  });

  it('aucune comparaison inventée avec la période précédente', () => {
    expect(rendu(<AgencyDecisionKpis data={dashboard()} jours={30} />)).not.toMatch(/vs |précédent/);
  });

  it('ton des avis : texte et pourcentage présents, pas seulement des couleurs', () => {
    const html = rendu(<TonDesAvis sentiments={[{ sentiment: 'positif', count: 27, pourcentage: 37.5 }, { sentiment: 'negatif', count: 31, pourcentage: 43.1 }] as DashboardAgence['sentiments']} />);
    expect(html).toContain('Positif');
    expect(html).toContain('37.5 %');
    expect(html).toContain('27 avis analysés');
    expect(html).toContain('Aucune donnée');
    expect(html).toContain('aria-hidden="true"');
  });

  it('ton des avis : aucune donnée', () => {
    expect(rendu(<TonDesAvis sentiments={[]} />)).toContain('Aucun avis analysé');
  });

  it('thèmes : liens réels vers les avis du thème, encodés', () => {
    const html = rendu(<ThemesDesAvis themes={[{ theme: 'accueil_conseillers', count: 7, pourcentage: 9.7 }, { theme: 'a/b', count: 1, pourcentage: 1 }]} />);
    expect(html).toContain('href="/feedbacks?theme=accueil_conseillers"');
    expect(html).toContain('href="/feedbacks?theme=a%2Fb"');
    expect(html).toContain('7 avis');
  });

  it('thèmes : au plus six, le reste est annoncé', () => {
    const themes = Array.from({ length: 9 }, (_, i) => ({ theme: `t${i}`, count: 1, pourcentage: 5 }));
    const html = rendu(<ThemesDesAvis themes={themes} />);
    expect((html.match(/href="\/feedbacks\?theme=/g) || []).length).toBe(6);
    expect(html).toContain('+3 autres thèmes');
  });

  it('tableau d’évolution : les mêmes données que le graphique, avec le volume', () => {
    const html = rendu(<TableauEvolution points={[{ date: '2026-10-01', taux: 60, nombre_feedbacks: 2 }, { date: '2026-10-02', taux: 80, nombre_feedbacks: 12 }]} />);
    expect(html).toContain('2026-10-01');
    expect(html).toContain('60 %');
    expect(html).toContain('(faible volume)');
    expect(html).toContain('scope="col"');
  });
});

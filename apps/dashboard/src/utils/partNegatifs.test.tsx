import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AgenceRankDetail, PartNegatifs, ThemeStatsDetail } from '../types';
import AgencesRankingTable from '../components/stats/AgencesRankingTable';
import ThemesBarList from '../components/stats/ThemesBarList';
import { FILTRES_INITIAUX, joursPeriode, parametresApi, parametresThemes, periodeDepuisUrl } from '../pages/agency/avisFiltres';
import { evolutionPartNegatifs, libellePartNegatifs, PartNegatifsTexte } from './partNegatifs';
import { lienAvisReseau } from './liensAgence';

const pn = (extra: Partial<PartNegatifs> = {}): PartNegatifs => ({
  negatifs: 5, total: 20, part: 25, total_precedent: 10, part_precedente: 10, evolution_pts: 15, statut_evolution: 'ok', ...extra,
});
const rendu = (element: React.ReactElement) => renderToStaticMarkup(<StaticRouter location="/stats">{element}</StaticRouter>);

describe('part d’avis négatifs et évolution (CX-05)', () => {
  it('hausse : flèche, points et libellé français (défavorable)', () => {
    const e = evolutionPartNegatifs(pn());
    expect(e).toMatchObject({ sens: 'defavorable', fleche: '↑' });
    expect(e.texte).toBe('+15 pts par rapport à la période précédente (en hausse)');
  });

  it('baisse : flèche vers le bas et sens favorable', () => {
    const e = evolutionPartNegatifs(pn({ evolution_pts: -7.5 }));
    expect(e).toMatchObject({ sens: 'favorable', fleche: '↓' });
    expect(e.texte).toBe('−7,5 pts par rapport à la période précédente (en baisse)');
  });

  it('stable : zéro point', () => {
    expect(evolutionPartNegatifs(pn({ evolution_pts: 0 }))).toMatchObject({ sens: 'neutre', fleche: '→', texte: 'Stable par rapport à la période précédente' });
  });

  it('période précédente de moins de 5 avis : « données insuffisantes », jamais un pourcentage', () => {
    const e = evolutionPartNegatifs(pn({ statut_evolution: 'insuffisant', evolution_pts: null, total_precedent: 4 }));
    expect(e.texte).toBe('Données insuffisantes pour comparer');
    expect(e.fleche).toBe('');
    expect(rendu(<PartNegatifsTexte pn={pn({ statut_evolution: 'insuffisant', evolution_pts: null })} />)).not.toMatch(/pts/);
  });

  it('aucun avis : « Aucun avis », pas de 0 % inventé ni de comparaison', () => {
    const vide = pn({ negatifs: 0, total: 0, part: null, statut_evolution: 'sans_avis', evolution_pts: null });
    expect(libellePartNegatifs(vide)).toBe('Aucun avis');
    expect(libellePartNegatifs(undefined)).toBe('Aucun avis');
    expect(evolutionPartNegatifs(vide).texte).toBe('');
    expect(rendu(<PartNegatifsTexte pn={vide} />)).not.toContain('0 %');
  });

  it('rendu : part, nombre d’avis et évolution lisibles sans la couleur', () => {
    const html = rendu(<PartNegatifsTexte pn={pn()} />);
    expect(html).toContain('25 %');
    expect(html).toContain('5 sur 20');
    expect(html).toContain('↑');
    expect(html).toContain('en hausse');
  });
});

describe('thèmes : clic vers la liste « Avis du réseau »', () => {
  const theme = (cle: string, part?: PartNegatifs): ThemeStatsDetail => ({ theme: cle, label: cle, count: 12, pourcentage: 40, sentiment_predominant: 'negatif', part_negatifs: part });

  it('le nom du thème est un lien qui transmet le thème, la période et l’agence', () => {
    const html = rendu(<ThemesBarList themes={[theme('accueil')]} lienTheme={(t) => lienAvisReseau({ theme: t.theme, jours: 30, agenceId: '11111111-1111-4111-8111-111111111111' })} />);
    expect(html).toContain('href="/feedbacks?agence=11111111-1111-4111-8111-111111111111&amp;theme=accueil&amp;jours=30"');
    expect(html).toContain('aria-label="Voir les avis du thème Accueil &amp; Conseillers"');
  });

  it('sans lien fourni, le thème n’est pas cliquable (autres vues inchangées)', () => {
    expect(rendu(<ThemesBarList themes={[theme('accueil')]} />)).not.toContain('<a ');
  });

  it('la part d’avis négatifs et son évolution s’affichent sous le thème', () => {
    const html = rendu(<ThemesBarList themes={[theme('attente', pn())]} />);
    expect(html).toContain('25 %');
    expect(html).toContain('en hausse');
  });

  it('les paramètres du lien deviennent les filtres de la liste : thème + période, et rien d’autre', () => {
    const periode = periodeDepuisUrl('30');
    expect(periode).toBe('30');
    const requete = parametresApi({ ...FILTRES_INITIAUX, theme: 'accueil', periode });
    expect(requete.theme).toBe('accueil');
    expect(requete.date_debut).toBeTruthy();
    expect(requete.sentiment).toBeUndefined();
    expect(periodeDepuisUrl('1')).toBe('today');
    expect(periodeDepuisUrl('14')).toBe('14');
    expect(periodeDepuisUrl('999')).toBe('all');
    expect(periodeDepuisUrl(null)).toBe('all');
  });
});

describe('onglet Thèmes de la page Avis : mêmes filtres que la liste, sauf le thème', () => {
  it('jours de la période', () => {
    expect(joursPeriode('all')).toBeUndefined();
    expect(joursPeriode('today')).toBe(1);
    expect(joursPeriode('90')).toBe(90);
  });

  it('transmet agence, période, ton, gravité, note, contradictions, recherche — jamais le thème', () => {
    const filtres = { ...FILTRES_INITIAUX, theme: 'accueil', periode: '30', sentiment: 'negatif', criticite: 'critique', note: '2', discordance: 'oui', recherche: ' file ' };
    const p = parametresThemes(filtres as typeof FILTRES_INITIAUX, { agenceFixe: 'ag-1' });
    expect(p).toEqual({ agence_id: 'ag-1', jours: 30, sentiment: 'negatif', criticite: 'critique', note: 2, discordance: true, q: 'file' });
    expect(p).not.toHaveProperty('theme');
    expect(parametresThemes(FILTRES_INITIAUX)).toEqual({});
  });
});

describe('classement des agences : part d’avis négatifs', () => {
  const agence = (nom: string, total: number, part?: PartNegatifs): AgenceRankDetail => ({
    agence_id: nom, agence_nom: nom, satisfaction_rate: total ? 60 : null, total_feedbacks: total, feedbacks_traites: 0, taux_traitement: null,
    alertes_critiques: 0, tendance_positive: true, wilson_score: 0.5, part_negatifs: part,
  });

  it('colonne « Avis négatifs » avec la part et l’évolution ; agence sans avis : tiret', () => {
    const html = rendu(<AgencesRankingTable agences={[agence('Lyon', 20, pn()), agence('Lille', 0)]} />);
    expect(html).toContain('Avis négatifs');
    expect(html).toContain('25 %');
    expect(html).toContain('en hausse');
  });
});

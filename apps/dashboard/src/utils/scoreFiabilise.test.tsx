import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AgencesRankingTable from '../components/stats/AgencesRankingTable';
import type { AgenceRankDetail } from '../types';
import { PHRASE_TRI_CLASSEMENT, mentionAvisEtFiabilite, niveauFiabilite } from './scoreFiabilise';

/** Borne basse de Wilson à 95 %, recalculée ici indépendamment de l'API (même formule que api/app/utils/stats.py). */
function wilson(positifs: number, total: number, z = 1.96): number {
  const p = positifs / total;
  const z2 = z * z;
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total);
}

const SOURCES = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const rang = (nom: string, wilsonScore: number): AgenceRankDetail =>
  ({ agence_id: nom, agence_nom: nom, ville: 'Ville', satisfaction_rate: 90, total_feedbacks: 12, feedbacks_traites: 5, taux_traitement: 40, alertes_critiques: 0,
    tendance_val: '+1.0 pts', tendance_positive: true, wilson_score: wilsonScore } as unknown as AgenceRankDetail);

const rangAvis = (nom: string, total: number, sat: number | null = 90): AgenceRankDetail => ({ ...rang(nom, 0.5), total_feedbacks: total, satisfaction_rate: sat } as AgenceRankDetail);
const tableau = (agences: AgenceRankDetail[]) => renderToStaticMarkup(<StaticRouter location="/statistiques"><AgencesRankingTable agences={agences} /></StaticRouter>);

describe('classement des agences (lot 3) : un seul pourcentage, trié par score fiabilisé', () => {
  it('fiabilité en un mot : faible (< 10 avis), moyenne (10 à 29), bonne (30 et plus)', () => {
    expect([0, 9, 10, 29, 30, 500].map(niveauFiabilite)).toEqual(['faible', 'faible', 'moyenne', 'moyenne', 'bonne', 'bonne']);
    expect(mentionAvisEtFiabilite(12)).toBe('12 avis · fiabilité moyenne');
    expect(mentionAvisEtFiabilite(1234)).toBe('1\u202f234 avis · fiabilité bonne');
  });

  it('le tableau n’affiche que la satisfaction, suivie du nombre d’avis et de la fiabilité ; plus de score fiabilisé', () => {
    const html = tableau([rangAvis('Alpha', 40), rangAvis('Beta', 3)]);
    expect(html).not.toMatch(/score fiabilis/i);
    expect(html).not.toContain('Avis collectés');
    expect(html).toContain('40 avis · fiabilité bonne');
    expect(html).toContain('3 avis · fiabilité faible');
    expect(html).not.toContain('80 %'); // la valeur du score (0,8) n’est plus affichée
  });

  it('l’ordre de l’API (score fiabilisé) est conservé et expliqué en une phrase sous le tableau', () => {
    const html = tableau([rang('Alpha', 0.8), rang('Beta', 0.5)]);
    expect(html.indexOf('Alpha')).toBeLessThan(html.indexOf('Beta'));
    expect(html).toContain('#1');
    expect(html).toContain(PHRASE_TRI_CLASSEMENT.replace(/’/g, '’'));
    expect(PHRASE_TRI_CLASSEMENT).toContain('Wilson à 95 %');
  });

  it('l’exemple de la phrase est vrai : 100 % sur 2 avis ne passe pas devant 90 % sur 200 avis', () => {
    expect(wilson(2, 2)).toBeLessThan(wilson(180, 200));
    expect(Math.round(wilson(2, 2) * 100)).toBe(34); // « environ 34 % » dans le commentaire du module
    expect(wilson(4, 4)).toBeLessThan(wilson(11, 12));
  });

  it('agence sans avis : « Pas d’avis », jamais de mention de fiabilité ni de 0 %', () => {
    const html = tableau([rangAvis('Gamma', 0, null)]);
    expect(html).toContain('Pas d&#x27;avis');
    expect(html).not.toContain('fiabilité');
  });

  it('« score fiabilisé » n’est plus écrit que dans le commentaire du module (aucun écran ne l’affiche)', () => {
    const fichiers = Object.entries(SOURCES).filter(([, texte]) => /score fiabilis/i.test(texte)).map(([chemin]) => chemin);
    expect(fichiers).toEqual(['/src/utils/scoreFiabilise.ts']);
  });
});

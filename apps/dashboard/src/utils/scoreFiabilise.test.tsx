import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AgencesRankingTable from '../components/stats/AgencesRankingTable';
import type { AgenceRankDetail } from '../types';
import { AIDE_SCORE_FIABILISE, LIBELLE_SCORE_FIABILISE } from './scoreFiabilise';

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

describe('« Score fiabilisé » (CX-03)', () => {
  it('le libellé est « Score fiabilisé », jamais « score de fiabilité »', () => {
    expect(LIBELLE_SCORE_FIABILISE).toBe('Score fiabilisé');
    expect(`${LIBELLE_SCORE_FIABILISE} ${AIDE_SCORE_FIABILISE}`).not.toMatch(/score de fiabilit/i);
  });

  it('l’aide décrit exactement la formule : borne basse de Wilson à 95 % sur les avis notés 4 ou 5', () => {
    expect(AIDE_SCORE_FIABILISE).toContain('borne basse');
    expect(AIDE_SCORE_FIABILISE).toContain('Wilson');
    expect(AIDE_SCORE_FIABILISE).toContain('95 %');
    expect(AIDE_SCORE_FIABILISE).toContain('avis notés 4 ou 5');
    expect(AIDE_SCORE_FIABILISE).toContain('Estimation prudente');
  });

  it('l’exemple de l’aide est vrai : 100 % sur 2 avis ne passe pas devant 90 % sur 200 avis', () => {
    expect(wilson(2, 2)).toBeLessThan(wilson(180, 200));
    expect(Math.round(wilson(2, 2) * 100)).toBe(34); // « environ 34 % » dans le commentaire du module
    // Exemple du cahier des charges : 100 % sur 4 avis derrière 11 avis sur 12.
    expect(wilson(4, 4)).toBeLessThan(wilson(11, 12));
  });

  it('le classement affiche le libellé, un bouton d’aide accessible et l’explication en clair', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/statistiques">
        <AgencesRankingTable agences={[rang('Alpha', 0.8), rang('Beta', 0.5)]} />
      </StaticRouter>,
    );
    expect(html).toContain('Score fiabilisé');
    expect(html).toContain('aria-label="À propos du score fiabilisé"');
    expect(html).toContain('<strong>Score fiabilisé</strong>');
    expect(html).toContain('borne basse de l’intervalle de confiance de Wilson à 95 %');
    expect(html).toContain('80%'); // valeur du score affichée
  });

  it('le libellé n’est écrit qu’à un seul endroit du code : plus de variante ni de texte dupliqué', () => {
    const fichiers = Object.entries(SOURCES).filter(([, texte]) => /score fiabilis/i.test(texte)).map(([chemin]) => chemin);
    expect(fichiers).toEqual(['/src/utils/scoreFiabilise.ts']);
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Feedback } from '../../types';
import { AvisCarteMobile, PastilleGravite, SignauxAvis, libelleAnalyseAbsente } from './avisAffichage';

const sansAnalyse = (analyse_statut?: Feedback['analyse_statut']): Feedback => ({
  id: 'f1', qr_code_id: 'q1', note: 2, commentaire: 'Attente trop longue', date_soumission: '2026-10-10T10:00:00Z', statut_traitement: 'nouveau',
  analyse_statut,
} as Feedback);

describe('IA-01 : avis dont l’analyse est indisponible', () => {
  it('affiche « Analyse indisponible » (jamais un vide) quand les reprises ont échoué', () => {
    expect(libelleAnalyseAbsente(sansAnalyse('indisponible'))).toBe('Analyse indisponible');
    expect(renderToStaticMarkup(<SignauxAvis feedback={sansAnalyse('indisponible')} />)).toContain('Analyse indisponible');
    expect(renderToStaticMarkup(<PastilleGravite feedback={sansAnalyse('indisponible')} />)).toContain('Analyse indisponible');
    const carte = renderToStaticMarkup(<AvisCarteMobile feedback={sansAnalyse('indisponible')} afficherAgence={false} onConsulter={() => {}} />);
    expect(carte).toContain('Analyse indisponible');
    expect(carte).toContain('Attente trop longue');      // l’avis reste lisible : note et texte
    expect(carte).toContain('★ 2/5');
  });

  it('garde le libellé actuel « Non analysé » pour un avis en attente ou sans statut (comportement existant)', () => {
    for (const statut of [undefined, 'en_attente', 'disponible'] as const) {
      expect(libelleAnalyseAbsente(sansAnalyse(statut))).toBe('Non analysé');
    }
    expect(renderToStaticMarkup(<SignauxAvis feedback={sansAnalyse('en_attente')} />)).toContain('Non analysé');
  });

  it('un avis analysé n’affiche aucun libellé d’indisponibilité', () => {
    const analyse = { ...sansAnalyse('disponible'), analyse_ia: { id: 'a1', sentiment: 'negatif', criticite: 'elevee', discordance_detectee: false } } as Feedback;
    const html = renderToStaticMarkup(<SignauxAvis feedback={analyse} />);
    expect(html).not.toContain('indisponible');
    expect(html).not.toContain('Non analysé');
  });
});

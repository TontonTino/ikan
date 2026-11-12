import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Feedback } from '../../types';

vi.mock('../../services/api', () => {
  const vide = () => Promise.resolve({ data: [], headers: {} });
  const proxy = new Proxy({}, { get: () => vide });
  return { feedbacksApi: proxy, issuesApi: proxy, agencesApi: proxy };
});

import FeedbackTreatmentModal, { referenceAvis } from './FeedbackTreatmentModal';

const avis = (surcharge: Partial<Feedback> = {}): Feedback => ({
  id: '56536653-1111-2222-3333-444455556666', qr_code_id: 'q', note: 1, commentaire: 'Attente trop longue', statut_traitement: 'nouveau',
  date_soumission: '2026-10-06T10:30:00Z', agence_nom: 'Agence Orange Pissy', agence_id: 'a1',
  analyse_ia: { id: 'x', sentiment: 'negatif', criticite: 'critique', discordance_detectee: false }, ...surcharge,
} as Feedback);

const fenetre = (f: Feedback, role: 'cx_manager' | 'agency_manager' = 'cx_manager') =>
  renderToStaticMarkup(<FeedbackTreatmentModal feedback={f} isOpen onClose={() => {}} onUpdateFeedback={() => {}} currentUserRole={role} currentUserName="P N" />);

describe('fenêtre de traitement d’un avis (lot 3)', () => {
  it('référence lisible : date et agence, plus d’identifiant tronqué', () => {
    expect(referenceAvis(avis())).toBe('Avis du 6 oct. 2026 · Agence Orange Pissy');
    expect(referenceAvis(avis({ agence_nom: undefined }))).toBe('Avis du 6 oct. 2026');
    const html = fenetre(avis());
    expect(html).toContain('Avis du 6 oct. 2026 · Agence Orange Pissy');
    expect(html).not.toMatch(/Avis #[0-9a-f]{8}/);
  });

  it('un seul statut, en français, en haut : le pied n’affiche plus la valeur brute', () => {
    const html = fenetre(avis({ statut_traitement: 'en_traitement' }));
    expect(html.split('Statut :').length - 1).toBe(1);
    expect(html).not.toMatch(/>en_traitement</i);
  });

  it('sections vides repliées sur une ligne : aucune action définie, aucun problème lié', () => {
    const html = fenetre(avis());
    expect(html).toContain('<strong>Action à mener</strong> : aucune définie pour l’instant.');
    expect(html).toContain('<strong>Problème à traiter lié</strong> : aucun.');
    expect(html).toContain('Lier à un problème');
    expect(html).not.toContain('Créer un nouveau problème');
  });

  it('un problème lié reste affiché en entier', () => {
    const html = fenetre(avis({ issue_id: 'i1' }));
    expect(html).not.toContain('<strong>Problème à traiter lié</strong> : aucun.');
    expect(html).toContain('Rattaché au problème');
  });
});

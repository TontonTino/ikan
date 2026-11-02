import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AgencyEvolution from '../agency/AgencyEvolution';
import PilotageActionsCorrectivesTab from '../../pages/cx/PilotageActionsCorrectivesTab';

type PropsActions = React.ComponentProps<typeof PilotageActionsCorrectivesTab>;
import YamChatPanel from './YamChatPanel';
import YamEtatVide from './YamEtatVide';
import YamNote from './YamNote';
import YamSynthese from './YamSynthese';

// Drapeau YAM_PRESENCE coupé (VITE_YAM_PRESENCE=non) : aucune intervention ne s'affiche.
vi.mock('../../config', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), YAM_PRESENCE: false }));
const etat = vi.hoisted(() => ({ messages: [] as unknown[], loading: false }));
vi.mock('./useYamChat', () => ({
  MAX_QUESTION_LENGTH: 500,
  useYamChat: () => ({ messages: etat.messages, loading: etat.loading, send: () => undefined, retry: () => undefined, reset: () => undefined }),
}));

describe('drapeau YAM_PRESENCE coupé', () => {
  it('bande de synthèse, note et état vide : rien n’est rendu', () => {
    const entrees = { jours: 30, nbAvis: 45, satisfaction: 80, agencesSousSeuil: [], agencesCritiques: [] };
    expect(renderToStaticMarkup(<YamSynthese entrees={entrees} />)).toBe('');
    expect(renderToStaticMarkup(<YamNote pointsFaibleVolume={3} />)).toBe('');
    expect(renderToStaticMarkup(<YamEtatVide titre="t" texte="x" />)).toBe('');
    expect(renderToStaticMarkup(<AgencyEvolution points={[{ date: '2026-10-01', taux: 80, nombre_feedbacks: 2 }]} periode="30 jours" />)).not.toContain('Trop peu d’avis');
  });

  it('panneau : ni rendu 3D, ni mascotte (accueil, attente, erreur) ; le texte de bienvenue reste', () => {
    etat.messages = [{ id: 'e1', role: 'error', text: 'Impossible de joindre YAM.', retryQuestion: 'q' }];
    etat.loading = true;
    const html = renderToStaticMarkup(<YamChatPanel open onClose={() => undefined} />);
    expect(html).not.toContain('yam-3d-face');
    expect(html).not.toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="18');
    expect(html).not.toContain('YAM analyse vos avis');
    expect(html).toContain('Impossible de joindre YAM.');
    expect(html).toContain('YAM réfléchit');
    etat.messages = [];
    etat.loading = false;
    const accueil = renderToStaticMarkup(<YamChatPanel open onClose={() => undefined} />);
    expect(accueil).not.toContain('yam-3d-face');
    expect(accueil).toContain('Bonjour, je suis');
  });

  it('page Actions : l’état vide d’origine est conservé', () => {
    const props = {
      isAgencyManager: false, agencesList: [], actionsToggle: 'en_cours', setActionsToggle: () => undefined, actionsEnCours: [], actionsTerminees: [],
      actionsEnCoursTotal: 0, actionsTermineesTotal: 0, actionsLoading: false, actionsError: false, refetchActions: () => undefined, actionsFirstLoadDone: true,
      actionsLoadingMore: false, loadMoreActions: () => undefined, actionsAgenceId: null, setActionsAgenceId: () => undefined, marquerActionRealisee: async () => undefined,
    };
    const html = renderToStaticMarkup(<MemoryRouter><PilotageActionsCorrectivesTab {...(props as unknown as PropsActions)} /></MemoryRouter>);
    expect(html).toContain('Aucune action n’est en attente de réalisation sur des avis clients.');
    expect(html).not.toContain('/yam/yam-3d-face');
  });
});

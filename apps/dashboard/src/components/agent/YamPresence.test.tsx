import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TendanceSatisfaction } from '../../types';
import { useYamStore } from '../../stores/yamStore';
import { FAIBLE_VOLUME_POINT } from '../../pages/cx/siege/siegeData';
import AgencyEvolution from '../agency/AgencyEvolution';
import { Evolution } from '../../pages/cx/siege/SiegeBlocks';
import PilotageActionsCorrectivesTab from '../../pages/cx/PilotageActionsCorrectivesTab';

type PropsActions = React.ComponentProps<typeof PilotageActionsCorrectivesTab>;
import type { EntreesSynthese } from './construireSynthese';
import YamEtatVide from './YamEtatVide';
import YamNote from './YamNote';
import YamSynthese from './YamSynthese';

// Session simulée : le rendu serveur de zustand lit l'état INITIAL du store (user = null), setState ne serait pas vu par renderToStaticMarkup.
const session = vi.hoisted(() => ({ user: null as { role: string } | null }));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: Object.assign((selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: session.user }), { getState: () => ({ user: session.user }) }),
}));

// Boutons capturés : le test déclenche l'action sans DOM (pas de jsdom dans ce projet).
const boutons = vi.hoisted(() => ({ liste: [] as { label: unknown; onClick?: () => void }[] }));
vi.mock('../ui/Button', () => ({
  default: (props: { children: React.ReactNode; onClick?: () => void }) => {
    boutons.liste.push({ label: props.children, onClick: props.onClick });
    return <button type="button">{props.children}</button>;
  },
}));

const ENTREES: EntreesSynthese = { jours: 30, nbAvis: 45, satisfaction: 87.5, agencesSousSeuil: ['Ouaga 2000'], agencesCritiques: [{ nom: 'Ouaga 2000', critiques: 4 }] };
const seConnecter = (role: 'cx_manager' | 'agency_manager' | 'admin') => {
  session.user = { role };
};

beforeEach(() => {
  boutons.liste = [];
  session.user = null;
  useYamStore.setState({ open: false, prefill: null });
});

describe('YamSynthese : rôles et bouton', () => {
  it('CX Manager : la bande s’affiche avec le titre, le message et le bouton', () => {
    seConnecter('cx_manager');
    const html = renderToStaticMarkup(<YamSynthese entrees={ENTREES} />);
    expect(html).toContain('YAM · 30 derniers jours');
    expect(html).toContain('Sur les 30 derniers jours, 45 avis');
    expect(html).toContain('Voir pourquoi');
    expect(html).toContain('data-yam-variant="tete"');
    expect(html).toContain('data-yam-state="accueil"');
  });

  it.each(['agency_manager', 'admin'] as const)('%s : rien n’est affiché', (role) => {
    seConnecter(role);
    expect(renderToStaticMarkup(<YamSynthese entrees={ENTREES} />)).toBe('');
  });

  it('personne de connecté : rien', () => {
    session.user = null;
    expect(renderToStaticMarkup(<YamSynthese entrees={ENTREES} />)).toBe('');
  });

  it('« Voir pourquoi » ouvre le panneau avec la question PRÉREMPLIE (rien n’est envoyé)', () => {
    seConnecter('cx_manager');
    renderToStaticMarkup(<YamSynthese entrees={ENTREES} />);
    const bouton = boutons.liste.find((b) => b.label === 'Voir pourquoi');
    expect(bouton?.onClick).toBeTypeOf('function');
    bouton!.onClick!();
    const { open, prefill } = useYamStore.getState();
    expect(open).toBe(true);
    expect(prefill?.text).toBe('Pourquoi Ouaga 2000 est sous son seuil ?');
  });

  it('agence concernée inconnue : question par défaut', () => {
    seConnecter('cx_manager');
    renderToStaticMarkup(<YamSynthese entrees={{ ...ENTREES, agencesSousSeuil: null }} />);
    boutons.liste.find((b) => b.label === 'Voir pourquoi')!.onClick!();
    expect(useYamStore.getState().prefill?.text).toBe('Quelle agence rencontre le plus de difficultés ?');
  });

  it('nombre d’avis inconnu : la bande ne s’affiche pas', () => {
    seConnecter('cx_manager');
    expect(renderToStaticMarkup(<YamSynthese entrees={{ ...ENTREES, nbAvis: null }} />)).toBe('');
  });
});

describe('yamStore', () => {
  it('open / toggle / close gardent leur comportement, ask et ouvrirAvec préremplissent', () => {
    const s = useYamStore;
    expect(s.getState().open).toBe(false);
    s.getState().toggle();
    expect(s.getState().open).toBe(true);
    s.getState().toggle();
    expect(s.getState().open).toBe(false);
    s.getState().ask('une question');
    expect(s.getState().open).toBe(true);
    expect(s.getState().prefill?.text).toBe('une question');
    s.getState().close();
    expect(s.getState().open).toBe(false);
    expect(s.getState().prefill?.text).toBe('une question');           // close ne touche pas à la question
    s.getState().ouvrirAvec('autre question');
    expect(s.getState().open).toBe(true);
    expect(s.getState().prefill?.text).toBe('autre question');
  });

  it('la même question redemandée produit une nouvelle demande (nouvel objet)', () => {
    useYamStore.getState().ouvrirAvec('q');
    const a = useYamStore.getState().prefill;
    useYamStore.getState().ouvrirAvec('q');
    expect(useYamStore.getState().prefill).not.toBe(a);
  });
});

describe('YamNote', () => {
  it('affichée quand au moins un point est à faible volume, avec le seuil de la constante existante', () => {
    const html = renderToStaticMarkup(<YamNote pointsFaibleVolume={2} />);
    expect(html).toContain('Trop peu d’avis pour conclure.');
    expect(html).toContain(`Plusieurs jours comptent moins de ${FAIBLE_VOLUME_POINT} avis`);
    expect(html).toContain('Je ne tire pas de tendance de ces points.');
    expect(html).toContain('data-yam-state="reflexion"');
  });

  it('absente sans point à faible volume', () => {
    expect(renderToStaticMarkup(<YamNote pointsFaibleVolume={0} />)).toBe('');
  });

  const points = (volumes: number[]): TendanceSatisfaction[] => volumes.map((n, i) => ({ date: `2026-10-0${i + 1}`, taux: 80, nombre_feedbacks: n }));

  it('sous le graphique de la page agence : note si un point est creux, rien sinon', () => {
    expect(renderToStaticMarkup(<AgencyEvolution points={points([12, 3, 20])} periode="30 jours" />)).toContain('Trop peu d’avis pour conclure.');
    expect(renderToStaticMarkup(<AgencyEvolution points={points([12, FAIBLE_VOLUME_POINT, 20])} periode="30 jours" />)).not.toContain('Trop peu d’avis');
    expect(renderToStaticMarkup(<AgencyEvolution points={[]} periode="30 jours" />)).not.toContain('Trop peu d’avis');
  });
});

describe('YamNote sous le graphique de la Vue réseau', () => {
  const point = (jour: number, feedbacks: number) => ({ date: `2026-10-${String(jour).padStart(2, '0')}`, label: `${jour} oct.`, feedbacks, traites: 0, satisfaction: 80, positifs: 0, neutres: 0, negatifs: 0 });
  const rendu = (volumes: number[]) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <Evolution stats={{ status: 'ok', data: { evolution_satisfaction: volumes.map((v, i) => point(i + 1, v)) } as never }} jours={30} onRetry={() => undefined} />
      </MemoryRouter>,
    );

  it('affichée si un point est à faible volume (logique existante, rien recalculé)', () => {
    const html = rendu([12, 2, 30]);
    expect(html).toContain('Trop peu d’avis pour conclure.');
    expect(html).toContain('point à faible volume');            // la mention existante du graphique est conservée
  });

  it('absente quand aucun point n’est à faible volume', () => {
    const html = rendu([12, FAIBLE_VOLUME_POINT, 30]);
    expect(html).not.toContain('Trop peu d’avis');
    expect(html).not.toContain('point à faible volume');
  });
});

describe('YamEtatVide', () => {
  it('titre, texte, rendu 3D détouré et bouton', () => {
    const html = renderToStaticMarkup(<YamEtatVide titre="Aucune action en cours." texte="Un texte." action={{ label: 'Voir les alertes', onClick: () => undefined }} />);
    expect(html).toContain('Aucune action en cours.');
    expect(html).toContain('Un texte.');
    expect(html).toContain('/yam/yam-3d-face.webp');
    expect(html).toContain('/yam/yam-3d-face@2x.png 2x');
    expect(html).toContain('width="120"');
    expect(html).toContain('Voir les alertes');
  });

  it('sans action : pas de bouton', () => {
    boutons.liste = [];
    renderToStaticMarkup(<YamEtatVide titre="t" texte="x" />);
    expect(boutons.liste).toHaveLength(0);
  });
});

describe('page Actions : état vide', () => {
  const props = (surcharge: Record<string, unknown> = {}) => ({
    isAgencyManager: false, agencesList: [], actionsToggle: 'en_cours' as const, setActionsToggle: () => undefined, actionsEnCours: [], actionsTerminees: [],
    actionsEnCoursTotal: 0, actionsTermineesTotal: 0, actionsLoading: false, actionsError: false, refetchActions: () => undefined, actionsFirstLoadDone: true,
    actionsLoadingMore: false, loadMoreActions: () => undefined, actionsAgenceId: null, setActionsAgenceId: () => undefined, marquerActionRealisee: async () => undefined,
    ...surcharge,
  });
  const rendre = (surcharge?: Record<string, unknown>) =>
    renderToStaticMarkup(<MemoryRouter><PilotageActionsCorrectivesTab {...(props(surcharge) as unknown as PropsActions)} /></MemoryRouter>);

  it('liste « en cours » vide : YAM, titre, texte et bouton « Voir les alertes »', () => {
    boutons.liste = [];
    const html = rendre();
    expect(html).toContain('Aucune action en cours.');
    expect(html).toContain('Quand un problème revient dans une agence, vous pourrez le regrouper ici et lancer une action. Commencez par consulter vos alertes.');
    expect(html).toContain('/yam/yam-3d-face.webp');
    const bouton = boutons.liste.find((b) => b.label === 'Voir les alertes');
    expect(bouton?.onClick).toBeTypeOf('function');
  });

  it('conservé tel quel : filtre d’agence (avec son bouton) et liste « terminées »', () => {
    const filtre = rendre({ actionsAgenceId: 'a1' });
    expect(filtre).toContain('Aucune action pour cette agence');
    expect(filtre).not.toContain('/yam/yam-3d-face');
    const terminees = rendre({ actionsToggle: 'terminees' });
    expect(terminees).toContain('Aucune action terminée pour l’instant');
    expect(terminees).not.toContain('/yam/yam-3d-face');
  });

  it('les éléments de la page (encadré, filtres de l’état) restent affichés', () => {
    const html = rendre();
    expect(html).toContain('Deux sortes d’actions');
    expect(html).toContain('aria-label="État des actions"');
  });
});

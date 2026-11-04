import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { UserRole } from '../../types';

const etat = vi.hoisted(() => ({ user: { id: 'moi', role: 'cx_manager', prenom: 'Awa', nom: 'Sawadogo' } as unknown }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));
vi.mock('../../config', () => ({ YAM_PRESENCE: false }));

import { BarreFiltresActions, LigneActionItem, idOuvrirProbleme } from './ActionsUnifiees';
import PilotageActionsTab from '../../pages/cx/PilotageActionsTab';
import {
  FILTRES_ACTIONS_PAR_DEFAUT,
  NOTE_EN_RETARD,
  NOTE_MES_ACTIONS,
  TEXTE_VIDE_EN_COURS_AGENCE,
  TEXTE_VIDE_EN_COURS_RESEAU,
  ligneDepuisAvis,
  ligneDepuisProbleme,
  type FiltresActions,
  type LigneAction,
} from '../../utils/actionsUnifiees';

const JOUR = 86_400_000;
const MAINTENANT = Date.now();
const il = (j: number) => new Date(MAINTENANT - j * JOUR).toISOString();
const dans = (j: number) => new Date(MAINTENANT + j * JOUR).toISOString();

const unProbleme = (extra: Record<string, unknown> = {}): LigneAction => ligneDepuisProbleme({
  id: 'a1', issue_id: 'i1', titre: 'Appeler le prestataire', statut: 'creee', responsable_id: 'u1', responsable_nom: 'Issa Bado', echeance: dans(3), date_completion: null,
  created_at: il(2), en_retard: false, derniere_a_faire: false, issue_titre: 'Climatisation en panne', agence_id: 'ag1', agence_nom: 'Agence Ouaga', ...extra,
} as never);
const unAvis = (extra: Record<string, unknown> = {}): LigneAction => ligneDepuisAvis({
  id: 'f1', action_a_prendre: 'Rappeler le client', action_realisee: false, assigne_a_nom: 'Mariam', date_assignation: il(5), note: 2, commentaire: 'Attente trop longue', date_soumission: il(6),
  agence_id: 'ag1', agence_nom: 'Agence Ouaga', ...extra,
} as never);

const ligne = (l: LigneAction, p: Partial<React.ComponentProps<typeof LigneActionItem>> = {}) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ul>
        <LigneActionItem ligne={l} afficherAgence role="cx_manager" moiId="moi" maintenant={MAINTENANT} problemeOuvertId={null} onOuvrirProbleme={() => undefined} onTerminer={() => undefined} {...p} />
      </ul>
    </MemoryRouter>,
  );

describe('une ligne d’action : origine visible, un seul badge', () => {
  it('action de problème : type « Problème », responsable, échéance, lien qui ouvre le problème', () => {
    const h = ligne(unProbleme());
    expect(h.match(/class="ui-badge/g)).toHaveLength(1);
    expect(h).toContain('>Problème<');
    expect(h).toContain('Appeler le prestataire');
    expect(h).toContain('Responsable : Issa Bado');
    expect(h).toMatch(/Échéance <time dateTime="[^"]+" title="[^"]+">\d{1,2} \S+ 20\d\d<\/time>/);
    expect(h).toContain('Agence Ouaga');
    expect(h).toContain(`id="${idOuvrirProbleme('probleme-a1')}"`);
    expect(h).toContain('Voir le problème « Climatisation en panne »');
  });

  it('action sur un avis : type « Avis », « Assignée à », lien vers Avis clients, jamais d’échéance', () => {
    const h = ligne(unAvis());
    expect(h.match(/class="ui-badge/g)).toHaveLength(1);
    expect(h).toContain('>Avis<');
    expect(h).toContain('Assignée à Mariam');
    expect(h).toContain('Retrouver l’avis dans « Avis clients »');
    expect(h).toContain('En cours depuis 5 jours');
    expect(h).not.toContain('Échéance');
    expect(h).not.toContain('Sans échéance');
  });

  it('retard : en mots seulement si en_retard est vrai ; sinon rien (jamais « à l’heure »)', () => {
    expect(ligne(unProbleme({ en_retard: true, echeance: il(2) }))).toContain('Échéance dépassée');
    for (const sans of [unProbleme({ en_retard: false }), unProbleme({ en_retard: null, echeance: null }), unAvis()]) {
      const h = ligne(sans);
      expect(h).not.toContain('Échéance dépassée');
      expect(h).not.toMatch(/à l[’']heure|dans les temps/i);
    }
  });

  it('sans échéance ni responsable : dit tel quel', () => {
    const h = ligne(unProbleme({ echeance: null, responsable_id: null, responsable_nom: null, en_retard: null }));
    expect(h).toContain('Sans échéance');
    expect(h).toContain('Sans responsable');
  });

  it('l’agence n’est affichée qu’au CX Manager', () => {
    expect(ligne(unProbleme(), { afficherAgence: false })).not.toContain('Agence Ouaga');
  });

  it('action terminée : date de fin, ni échéance ni bouton', () => {
    const h = ligne(unProbleme({ statut: 'terminee', date_completion: il(1) }));
    expect(h).toContain('Terminée le <time');
    expect(h).not.toContain('Échéance');
    expect(h).not.toContain('>Terminer<');
  });

  it('le problème dont le panneau est ouvert est annoncé (aria-current)', () => {
    expect(ligne(unProbleme(), { problemeOuvertId: 'i1' })).toContain('aria-current="true"');
    expect(ligne(unProbleme(), { problemeOuvertId: 'autre' })).not.toContain('aria-current');
  });
});

describe('« Terminer » selon le rôle', () => {
  const bouton = (l: LigneAction, role: UserRole | undefined, moiId = 'moi') => ligne(l, { role, moiId }).includes('>Terminer<');

  it('CX Manager : toute action de problème à faire', () => {
    expect(bouton(unProbleme(), 'cx_manager')).toBe(true);
  });

  it('Agency Manager : seulement ses propres actions', () => {
    expect(bouton(unProbleme({ responsable_id: 'moi' }), 'agency_manager')).toBe(true);
    expect(bouton(unProbleme({ responsable_id: 'autre' }), 'agency_manager')).toBe(false);
    expect(bouton(unProbleme({ responsable_id: null, responsable_nom: null }), 'agency_manager')).toBe(false);
  });

  it('administrateur ou rôle inconnu : aucun bouton, rien de grisé', () => {
    for (const role of ['admin', undefined] as Array<UserRole | undefined>) {
      const h = ligne(unProbleme({ responsable_id: 'moi' }), { role });
      expect(h).not.toContain('>Terminer<');
      expect(h).not.toContain('disabled');
    }
  });

  it('action sur avis : « Marquer comme réalisée » (flux existant), pas « Terminer »', () => {
    const h = ligne(unAvis(), { confirmationAvis: { ouverte: false, occupe: false, onDemander: () => undefined, onConfirmer: () => undefined, onAnnuler: () => undefined } });
    expect(h).toContain('Marquer comme réalisée');
    expect(h).not.toContain('>Terminer<');
  });

  it('confirmation d’une action sur avis : dit la conséquence, boutons désactivés pendant l’envoi', () => {
    const h = ligne(unAvis(), { confirmationAvis: { ouverte: true, occupe: true, onDemander: () => undefined, onConfirmer: () => undefined, onAnnuler: () => undefined } });
    expect(h).toContain('l’avis passera à « Résolu »');
    expect(h).toContain('Cela n’indique pas que le client est satisfait.');
    expect(h.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('segments et filtres', () => {
  const barre = (f: FiltresActions = FILTRES_ACTIONS_PAR_DEFAUT, en: number | null = 3, term: number | null = 7) =>
    renderToStaticMarkup(<BarreFiltresActions filtres={f} onChange={() => undefined} totalEnCours={en} totalTerminees={term} />);

  it('segments avec leurs totaux ; sans total connu, aucun zéro trompeur', () => {
    expect(barre()).toContain('En cours (3)');
    expect(barre()).toContain('Terminées (7)');
    const inconnu = barre(FILTRES_ACTIONS_PAR_DEFAUT, null, null);
    expect(inconnu).not.toMatch(/En cours \(|Terminées \(/);
  });

  it('type, « En retard » (en cours seulement), « Mes actions »', () => {
    const h = barre();
    for (const t of ['Problèmes et avis', 'Problèmes', 'Avis', 'En retard', 'Mes actions']) expect(h).toContain(t);
    expect(barre({ ...FILTRES_ACTIONS_PAR_DEFAUT, segment: 'terminees' })).not.toContain('En retard');
  });

  it('bascules : aria-pressed ; « Effacer les filtres » seulement si un filtre est actif', () => {
    expect(barre()).not.toContain('Effacer les filtres');
    const actif = barre({ ...FILTRES_ACTIONS_PAR_DEFAUT, enRetard: true, mesActions: true });
    expect(actif.match(/aria-pressed="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(actif).toContain('Effacer les filtres');
  });

  it('les deux filtres qui ne concernent pas les avis le disent', () => {
    const h = barre({ ...FILTRES_ACTIONS_PAR_DEFAUT, enRetard: true, mesActions: true });
    expect(h).toContain(NOTE_EN_RETARD);
    expect(h).toContain(NOTE_MES_ACTIONS);
    expect(barre()).not.toContain(NOTE_EN_RETARD);
  });
});

describe('page « Actions à mener » : états', () => {
  const base = {
    isAgencyManager: false, agencesList: [], filtres: FILTRES_ACTIONS_PAR_DEFAUT, setFiltres: () => undefined, lignes: [] as LigneAction[], total: 0, autreTotal: 0, chargement: false,
    premierChargement: true, erreur: false, chargementSuite: false, partiel: false, recharger: () => undefined, chargerSuite: () => undefined, confirmerAvis: async () => undefined,
    apresTerminaison: async () => undefined, openIssueDetail: async () => undefined, selectedIssueId: null, issueDetail: null, issueDetailLoading: false, closeIssueDetail: () => undefined,
    apresActionIssue: async () => undefined, verifierIssue: async () => undefined,
  };
  const rendre = (surcharge: Record<string, unknown> = {}, role: UserRole = 'cx_manager') => {
    etat.user = { id: 'moi', role, prenom: 'P', nom: 'N' };
    return renderToStaticMarkup(<MemoryRouter><PilotageActionsTab {...({ ...base, isAgencyManager: role === 'agency_manager', ...surcharge } as unknown as React.ComponentProps<typeof PilotageActionsTab>)} /></MemoryRouter>);
  };

  it('chargement : squelette occupé', () => {
    const h = rendre({ chargement: true });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('Chargement des actions à mener');
  });

  it('erreur : ne laisse pas croire qu’il n’y a rien, avec « Réessayer »', () => {
    const h = rendre({ erreur: true });
    expect(h).toContain('Cela ne signifie pas qu’il n’y en a pas');
    expect(h).toContain('Réessayer');
    expect(h).not.toContain('Aucune action en cours');
  });

  it('vide sans filtre : le texte exact de ce que fait la page, par rôle', () => {
    expect(rendre()).toContain(TEXTE_VIDE_EN_COURS_RESEAU);
    expect(rendre({}, 'agency_manager')).toContain(TEXTE_VIDE_EN_COURS_AGENCE);
    expect(rendre({}, 'agency_manager')).not.toContain(TEXTE_VIDE_EN_COURS_RESEAU);
  });

  it('vide avec filtres : le dit, avec « Effacer les filtres »', () => {
    const h = rendre({ filtres: { ...FILTRES_ACTIONS_PAR_DEFAUT, enRetard: true } });
    expect(h).toContain('Aucune action pour ces filtres');
    expect(h).toContain('Effacer les filtres');
    expect(h).not.toContain(TEXTE_VIDE_EN_COURS_RESEAU);
  });

  it('liste unique : actions de problème ET d’avis ensemble, type visible, tri vrai', () => {
    const lignes = [unAvis(), unProbleme({ en_retard: true, echeance: il(1) })];
    const h = rendre({ lignes, total: 2 });
    expect(h.match(/data-origine="probleme"/g)).toHaveLength(1);
    expect(h.match(/data-origine="avis"/g)).toHaveLength(1);
    expect(h).toContain('>Problème<');
    expect(h).toContain('>Avis<');
    expect(h).not.toContain('Deux sortes d’actions');
    expect(h).not.toContain('Charger plus');
  });

  it('partiel : « 1 actions chargées sur 120 » vrai et « Charger plus »', () => {
    const h = rendre({ lignes: [unProbleme()], total: 120, partiel: true });
    expect(h).toContain('1 actions chargées sur 120.');
    expect(h).toContain('Charger plus (1/120)');
  });

  it('segments : totaux du segment courant et de l’autre', () => {
    const h = rendre({ lignes: [unProbleme()], total: 4, autreTotal: 9 });
    expect(h).toContain('En cours (4)');
    expect(h).toContain('Terminées (9)');
  });

  it('terminées : la phrase « fait ne veut pas dire client satisfait »', () => {
    expect(rendre({ filtres: { ...FILTRES_ACTIONS_PAR_DEFAUT, segment: 'terminees' } })).toContain('pas que le client est satisfait');
  });

  it('le CX voit le filtre d’agence et l’agence des lignes ; l’Agency Manager non', () => {
    const lignes = [unProbleme()];
    expect(rendre({ lignes, total: 1, agencesList: [{ id: 'ag1', nom: 'Ouaga' }] })).toContain('Agence Ouaga');
    expect(rendre({ lignes, total: 1 }, 'agency_manager')).not.toContain('Agence Ouaga');
  });
});

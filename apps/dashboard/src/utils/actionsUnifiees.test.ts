import { describe, expect, it } from 'vitest';
import type { ActionProbleme, Feedback } from '../types';
import {
  FILTRES_ACTIONS_PAR_DEFAUT,
  NOTE_EN_RETARD,
  TEXTE_VIDE_EN_COURS_AGENCE,
  TEXTE_VIDE_EN_COURS_RESEAU,
  aDesFiltresActions,
  interrogerLesAvis,
  interrogerLesProblemes,
  libelleChargement,
  ligneDepuisAvis,
  ligneDepuisProbleme,
  parametresActionsProbleme,
  peutTerminerLigne,
  texteRetardAction,
  trierLignes,
  type LigneAction,
} from './actionsUnifiees';

const JOUR = 86_400_000;
const T0 = new Date('2026-11-04T12:00:00Z').getTime();
const il = (j: number) => new Date(T0 - j * JOUR).toISOString();
const dans = (j: number) => new Date(T0 + j * JOUR).toISOString();

const probleme = (extra: Partial<ActionProbleme> = {}): ActionProbleme => ({
  id: 'a1', issue_id: 'i1', titre: 'Appeler le prestataire', statut: 'creee', responsable_id: 'u1', responsable_nom: 'Issa Bado', echeance: dans(3), date_completion: null,
  created_at: il(2), en_retard: false, derniere_a_faire: true, issue_titre: 'Climatisation en panne', agence_id: 'ag1', agence_nom: 'Agence Ouaga', ...extra,
});
const avis = (extra: Partial<Feedback> = {}): Feedback =>
  ({ id: 'f1', action_a_prendre: 'Rappeler le client', action_realisee: false, assigne_a_nom: 'Mariam', date_assignation: il(5), note: 2, commentaire: 'Trop long', date_soumission: il(6), agence_id: 'ag1', agence_nom: 'Agence Ouaga', ...extra } as Feedback);

describe('paramètres de GET /issues/actions', () => {
  it('l’état vient du segment ; les autres filtres seulement s’ils sont actifs', () => {
    expect(parametresActionsProbleme(FILTRES_ACTIONS_PAR_DEFAUT, 'moi')).toEqual({ limit: 50, offset: 0, etat: 'a_faire' });
    expect(parametresActionsProbleme({ ...FILTRES_ACTIONS_PAR_DEFAUT, segment: 'terminees' }, 'moi')).toMatchObject({ etat: 'terminee' });
    expect(parametresActionsProbleme({ ...FILTRES_ACTIONS_PAR_DEFAUT, enRetard: true, mesActions: true, agenceId: 'ag1' }, 'moi', 50)).toEqual({
      limit: 50, offset: 50, etat: 'a_faire', en_retard: true, responsable_id: 'moi', agence_id: 'ag1',
    });
  });

  it('« En retard » inactif : aucun paramètre en_retard (jamais en_retard=false)', () => {
    expect(parametresActionsProbleme(FILTRES_ACTIONS_PAR_DEFAUT, 'moi')).not.toHaveProperty('en_retard');
  });

  it('total de l’AUTRE segment : même filtres, une ligne suffit', () => {
    expect(parametresActionsProbleme(FILTRES_ACTIONS_PAR_DEFAUT, 'moi', 0, 1, 'terminees')).toEqual({ limit: 1, offset: 0, etat: 'terminee' });
  });

  it('« En retard » ne s’applique jamais aux actions terminées (ni au total de « Terminées »)', () => {
    expect(parametresActionsProbleme({ ...FILTRES_ACTIONS_PAR_DEFAUT, segment: 'terminees', enRetard: true }, 'moi')).not.toHaveProperty('en_retard');
    expect(parametresActionsProbleme({ ...FILTRES_ACTIONS_PAR_DEFAUT, enRetard: true }, 'moi', 0, 1, 'terminees')).not.toHaveProperty('en_retard');
  });

  it('« Mes actions » sans utilisateur connu : pas de responsable_id inventé', () => {
    expect(parametresActionsProbleme({ ...FILTRES_ACTIONS_PAR_DEFAUT, mesActions: true }, undefined)).not.toHaveProperty('responsable_id');
  });
});

describe('quelle source interroger', () => {
  it('par défaut : les deux', () => {
    expect(interrogerLesAvis(FILTRES_ACTIONS_PAR_DEFAUT)).toBe(true);
    expect(interrogerLesProblemes(FILTRES_ACTIONS_PAR_DEFAUT)).toBe(true);
  });

  it('type : une seule source', () => {
    expect([interrogerLesAvis({ ...FILTRES_ACTIONS_PAR_DEFAUT, type: 'probleme' }), interrogerLesProblemes({ ...FILTRES_ACTIONS_PAR_DEFAUT, type: 'probleme' })]).toEqual([false, true]);
    expect([interrogerLesAvis({ ...FILTRES_ACTIONS_PAR_DEFAUT, type: 'avis' }), interrogerLesProblemes({ ...FILTRES_ACTIONS_PAR_DEFAUT, type: 'avis' })]).toEqual([true, false]);
  });

  it('« En retard » et « Mes actions » ne concernent jamais les actions sur avis (ni échéance, ni responsable désigné)', () => {
    expect(interrogerLesAvis({ ...FILTRES_ACTIONS_PAR_DEFAUT, enRetard: true })).toBe(false);
    expect(interrogerLesAvis({ ...FILTRES_ACTIONS_PAR_DEFAUT, mesActions: true })).toBe(false);
    expect(interrogerLesProblemes({ ...FILTRES_ACTIONS_PAR_DEFAUT, enRetard: true })).toBe(true);
  });

  it('filtres actifs : type, retard, mes actions (le segment et l’agence ne comptent pas)', () => {
    expect(aDesFiltresActions(FILTRES_ACTIONS_PAR_DEFAUT)).toBe(false);
    expect(aDesFiltresActions({ ...FILTRES_ACTIONS_PAR_DEFAUT, segment: 'terminees', agenceId: 'ag1' })).toBe(false);
    expect(aDesFiltresActions({ ...FILTRES_ACTIONS_PAR_DEFAUT, type: 'avis' })).toBe(true);
  });
});

describe('lignes de la liste unique', () => {
  it('action de problème : origine, responsable, échéance, problème d’origine', () => {
    const l = ligneDepuisProbleme(probleme());
    expect(l).toMatchObject({ origine: 'probleme', cle: 'probleme-a1', issueId: 'i1', issueTitre: 'Climatisation en panne', responsableNom: 'Issa Bado', enRetard: false, terminee: false, derniereAFaire: true });
  });

  it('action sur avis : jamais d’échéance ni de retard', () => {
    const l = ligneDepuisAvis(avis());
    expect(l).toMatchObject({ origine: 'avis', cle: 'avis-f1', titre: 'Rappeler le client', responsableNom: 'Mariam', echeance: null, enRetard: null, terminee: false });
  });

  it('action sur avis sans détail : « Action non détaillée », jamais un titre inventé', () => {
    expect(ligneDepuisAvis(avis({ action_a_prendre: undefined })).titre).toBe('Action non détaillée');
  });

  it('terminée : dates de fin lues, pas inventées', () => {
    expect(ligneDepuisProbleme(probleme({ statut: 'terminee', date_completion: il(1) }))).toMatchObject({ terminee: true, dateFin: il(1) });
    expect(ligneDepuisAvis(avis({ action_realisee: true, date_resolution: il(1) }))).toMatchObject({ terminee: true, dateFin: il(1) });
  });
});

describe('ordre de la liste', () => {
  const l = (extra: Partial<LigneAction>): LigneAction => ({ cle: 'x', origine: 'probleme', id: 'x', titre: 'x', enRetard: null, terminee: false, ...extra });

  it('en cours : en retard d’abord, puis échéance proche, puis les autres du plus ancien au plus récent', () => {
    const lignes = [
      l({ cle: 'sans-recent', depuis: il(1) }), l({ cle: 'loin', echeance: dans(9), enRetard: false }), l({ cle: 'proche', echeance: dans(1), enRetard: false }),
      l({ cle: 'retard-plus-ancien', echeance: il(5), enRetard: true }), l({ cle: 'retard-recent', echeance: il(1), enRetard: true }), l({ cle: 'sans-ancien', depuis: il(8) }),
    ];
    expect(trierLignes(lignes, 'en_cours').map((x) => x.cle)).toEqual(['retard-plus-ancien', 'retard-recent', 'proche', 'loin', 'sans-ancien', 'sans-recent']);
  });

  it('terminées : la plus récemment terminée d’abord', () => {
    const lignes = [l({ cle: 'a', terminee: true, dateFin: il(5) }), l({ cle: 'b', terminee: true, dateFin: il(1) }), l({ cle: 'c', terminee: true, dateFin: null })];
    expect(trierLignes(lignes, 'terminees').map((x) => x.cle)).toEqual(['b', 'a', 'c']);
  });

  it('le tri ne modifie pas la liste d’origine', () => {
    const d = [l({ cle: 'b', depuis: il(1) }), l({ cle: 'a', depuis: il(2) })];
    trierLignes(d, 'en_cours');
    expect(d.map((x) => x.cle)).toEqual(['b', 'a']);
  });
});

describe('qui peut terminer', () => {
  const p = ligneDepuisProbleme(probleme({ responsable_id: 'moi' }));

  it('CX Manager : toute action de problème à faire', () => {
    expect(peutTerminerLigne(p, 'cx_manager', 'cx')).toBe(true);
  });

  it('Agency Manager : seulement les actions dont il est le responsable', () => {
    expect(peutTerminerLigne(p, 'agency_manager', 'moi')).toBe(true);
    expect(peutTerminerLigne(p, 'agency_manager', 'autre')).toBe(false);
    expect(peutTerminerLigne(ligneDepuisProbleme(probleme({ responsable_id: null })), 'agency_manager', 'moi')).toBe(false);
  });

  it('administrateur, rôle inconnu, action déjà terminée, action sur avis : jamais', () => {
    expect(peutTerminerLigne(p, 'admin', 'moi')).toBe(false);
    expect(peutTerminerLigne(p, undefined, 'moi')).toBe(false);
    expect(peutTerminerLigne(ligneDepuisProbleme(probleme({ statut: 'terminee' })), 'cx_manager', 'cx')).toBe(false);
    expect(peutTerminerLigne(ligneDepuisAvis(avis()), 'cx_manager', 'cx')).toBe(false);
  });
});

describe('textes : vrais, sans promesse trompeuse', () => {
  it('retard : en mots, seulement si l’API le dit', () => {
    expect(texteRetardAction({ enRetard: true })).toBe('Échéance dépassée');
    expect(texteRetardAction({ enRetard: false })).toBeNull();
    expect(texteRetardAction({ enRetard: null })).toBeNull();
    expect(texteRetardAction({ enRetard: null }) ?? '').not.toMatch(/à l[’']heure|dans les temps/i);
  });

  it('chargement partiel : vrai, sinon rien', () => {
    expect(libelleChargement(50, 120)).toBe('50 actions chargées sur 120.');
    expect(libelleChargement(3, 3)).toBeNull();
  });

  it('textes d’état vide : disent ce que la page fait (problème ET avis), sans « regrouper » ni « lancer »', () => {
    for (const t of [TEXTE_VIDE_EN_COURS_RESEAU, TEXTE_VIDE_EN_COURS_AGENCE]) {
      expect(t).toContain('problème');
      expect(t).toContain('avis');
      expect(t).not.toMatch(/regrouper|lancer/);
    }
    expect(NOTE_EN_RETARD).toContain('pas d’échéance');
  });
});

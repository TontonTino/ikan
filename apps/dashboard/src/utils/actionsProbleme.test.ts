import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import type { ActionCorrective, IssueStatut, UserRole } from '../types';
import {
  MESSAGES_DEFINIR,
  MESSAGES_TERMINER,
  SANS_RESPONSABLE,
  chargeCreation,
  classerEchecAction,
  echeanceVersIso,
  envoyerCreationAction,
  envoyerTerminaison,
  jourLocal,
  libelleEtatAction,
  libelleResponsable,
  peutDefinirAction,
  peutTerminerAction,
  peutVerifierResolution,
  personnesAssignables,
  validerSaisie,
  type SaisieAction,
  type UtilisateurListe,
} from './actionsProbleme';
import { estAuPremierPlan } from '../components/ui/useOverlay';

const erreurHttp = (status: number, data: unknown = {}) =>
  new AxiosError('échec', 'ERR_BAD_RESPONSE', undefined, undefined, { status, data, statusText: '', headers: {}, config: {} as never });
const erreurReseau = () => new AxiosError('Network Error', 'ERR_NETWORK');

const STATUTS: IssueStatut[] = ['ouverte', 'action_en_cours', 'resolue', 'verifiee', 'reouverte'];

describe('droits : qui voit « Définir une action », « Terminer » et « Confirmer la résolution »', () => {
  it('Définir : le CX Manager seul, sur un problème encore à traiter', () => {
    const attendu: Record<IssueStatut, boolean> = { ouverte: true, reouverte: true, action_en_cours: true, resolue: false, verifiee: false };
    for (const s of STATUTS) expect(peutDefinirAction('cx_manager', s)).toBe(attendu[s]);
    for (const role of ['agency_manager', 'admin', undefined] as Array<UserRole | undefined>) {
      for (const s of STATUTS) expect(peutDefinirAction(role, s)).toBe(false);
    }
  });

  it('Terminer : le CX Manager toujours ; l’Agency Manager seulement ses propres actions ; jamais un autre rôle', () => {
    expect(peutTerminerAction('cx_manager')).toBe(true);
    expect(peutTerminerAction('cx_manager', 'autre', 'moi')).toBe(true);
    expect(peutTerminerAction('agency_manager', 'moi', 'moi')).toBe(true);
    expect(peutTerminerAction('agency_manager', 'autre', 'moi')).toBe(false);
    expect(peutTerminerAction('agency_manager', null, 'moi')).toBe(false);
    expect(peutTerminerAction('agency_manager', 'moi', undefined)).toBe(false);
    expect(peutTerminerAction('agency_manager')).toBe(false);
    expect(peutTerminerAction('admin', 'moi', 'moi')).toBe(false);
    expect(peutTerminerAction(undefined)).toBe(false);
  });

  it('Confirmer la résolution : le CX Manager seul', () => {
    expect(peutVerifierResolution('cx_manager')).toBe(true);
    expect(peutVerifierResolution('agency_manager')).toBe(false);
    expect(peutVerifierResolution('admin')).toBe(false);
  });
});

describe('saisie', () => {
  const ok: SaisieAction = { titre: 'Réparer la climatisation', description: '', responsableId: 'u1', echeance: '' };

  it('une saisie complète est valide ; l’échéance est facultative', () => {
    expect(validerSaisie(ok, '2026-11-04')).toEqual({});
    expect(validerSaisie({ ...ok, echeance: '2026-11-04' }, '2026-11-04')).toEqual({});
  });

  it('l’intitulé fait 3 à 200 caractères (espaces retirés)', () => {
    expect(validerSaisie({ ...ok, titre: '  ab  ' }, '2026-11-04').titre).toContain('3 caractères');
    expect(validerSaisie({ ...ok, titre: '' }, '2026-11-04').titre).toBeDefined();
    expect(validerSaisie({ ...ok, titre: 'x'.repeat(201) }, '2026-11-04').titre).toContain('200');
    expect(validerSaisie({ ...ok, titre: 'x'.repeat(200) }, '2026-11-04').titre).toBeUndefined();
  });

  it('le responsable est un choix explicite : non choisi = erreur, « sans responsable » = valide', () => {
    expect(validerSaisie({ ...ok, responsableId: '' }, '2026-11-04').responsable).toBeDefined();
    expect(validerSaisie({ ...ok, responsableId: SANS_RESPONSABLE }, '2026-11-04').responsable).toBeUndefined();
  });

  it('l’échéance ne peut pas être dans le passé', () => {
    expect(validerSaisie({ ...ok, echeance: '2026-11-03' }, '2026-11-04').echeance).toBe('L’échéance ne peut pas être dans le passé.');
    expect(validerSaisie({ ...ok, echeance: 'demain' }, '2026-11-04').echeance).toBe('Indiquez une date valide.');
  });

  it('jourLocal : jour du calendrier local, sur deux chiffres', () => {
    expect(jourLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('corps envoyé : champs nettoyés, facultatifs absents, « sans responsable » = aucun responsable_id', () => {
    expect(chargeCreation({ titre: '  Réparer  ', description: '  ', responsableId: SANS_RESPONSABLE, echeance: '' })).toEqual({ titre: 'Réparer' });
    expect(chargeCreation({ titre: 'Réparer', description: ' vite ', responsableId: 'u1', echeance: '2026-11-12' })).toEqual({
      titre: 'Réparer',
      description: 'vite',
      responsable_id: 'u1',
      echeance: '2026-11-12T12:00:00Z',
    });
    expect(echeanceVersIso('2026-11-12')).toBe('2026-11-12T12:00:00Z');
  });
});

describe('responsables proposés : le périmètre du problème', () => {
  const moi = { id: 'cx', prenom: 'Awa', nom: 'Traoré' };
  const u = (id: string, nom: string, agence: string | null, extra: Partial<UtilisateurListe> = {}): UtilisateurListe => ({ id, nom, prenom: 'P', role: 'agency_manager', agence_id: agence, active: true, ...extra });
  const liste = [
    u('a2', 'Zongo', 'agence-1'),
    u('a1', 'Bado', 'agence-1'),
    u('b1', 'Kaboré', 'agence-2'),                              // autre agence : l’API l’accepterait (201) mais il ne pourrait pas ouvrir le problème (403)
    u('a3', 'Inactif', 'agence-1', { active: false }),
    u('a4', 'Sans agence', null),
    u('c1', 'AutreCX', null, { role: 'cx_manager' }),
  ];

  it('seulement les Agency Managers actifs de l’agence du problème, plus soi-même en premier', () => {
    const p = personnesAssignables(liste, 'agence-1', moi);
    expect(p.map((x) => x.id)).toEqual(['cx', 'a1', 'a2']);
    expect(p[0].libelle).toBe('Moi (Awa Traoré)');
  });

  it('un responsable d’une autre agence n’est JAMAIS proposé', () => {
    expect(personnesAssignables(liste, 'agence-1', moi).some((x) => x.id === 'b1')).toBe(false);
    expect(personnesAssignables(liste, 'agence-2', moi).map((x) => x.id)).toEqual(['cx', 'b1']);
  });

  it('liste illisible : seul « moi » est proposé (rien n’est simulé)', () => {
    expect(personnesAssignables([], 'agence-1', moi).map((x) => x.id)).toEqual(['cx']);
  });

  it('nom d’un responsable : « Vous », le nom connu, sinon « Assigné » ; jamais un nom inventé', () => {
    expect(libelleResponsable('cx', liste, 'cx')).toBe('Vous');
    expect(libelleResponsable('a1', liste, 'cx')).toBe('P Bado');
    expect(libelleResponsable('inconnu', liste, 'cx')).toBe('Assigné');
    expect(libelleResponsable(undefined, liste, 'cx')).toBe('Sans responsable');
    expect(libelleResponsable('a1', [], 'am')).toBe('Assigné');
  });
});

describe('erreurs : un message clair en français par code, jamais le texte du serveur', () => {
  it.each([
    [403, 'refus', MESSAGES_DEFINIR.refus],
    [404, 'disparu', MESSAGES_DEFINIR.introuvable],
    [409, 'disparu', MESSAGES_DEFINIR.conflit],
    [422, 'saisie', MESSAGES_DEFINIR.saisie],
    [500, 'serveur', MESSAGES_DEFINIR.serveur],
    [503, 'serveur', MESSAGES_DEFINIR.serveur],
  ])('définir : %i → %s', (statut, nature, message) => {
    expect(classerEchecAction(erreurHttp(statut, { detail: 'texte brut du serveur' }), MESSAGES_DEFINIR)).toEqual({ nature, message });
  });

  it('définir : 400 sur le responsable → message dédié ; autre 400 → message de saisie', () => {
    expect(classerEchecAction(erreurHttp(400, { detail: 'responsable_id invalide : utilisateur introuvable' }), MESSAGES_DEFINIR)).toEqual({ nature: 'saisie', message: MESSAGES_DEFINIR.responsable });
    expect(classerEchecAction(erreurHttp(400, { detail: 'autre' }), MESSAGES_DEFINIR).message).toBe(MESSAGES_DEFINIR.saisie);
  });

  it('réseau coupé ou erreur inconnue : on peut réessayer, la saisie est conservée', () => {
    expect(classerEchecAction(erreurReseau(), MESSAGES_DEFINIR)).toEqual({ nature: 'serveur', message: MESSAGES_DEFINIR.reseau });
    expect(classerEchecAction(new Error('?'), MESSAGES_DEFINIR)).toEqual({ nature: 'serveur', message: MESSAGES_DEFINIR.serveur });
  });

  it('terminer : mêmes classes, messages propres à la clôture', () => {
    expect(classerEchecAction(erreurHttp(403), MESSAGES_TERMINER, false)).toEqual({ nature: 'refus', message: MESSAGES_TERMINER.refus });
    expect(classerEchecAction(erreurHttp(404), MESSAGES_TERMINER, false).nature).toBe('disparu');
    expect(classerEchecAction(erreurHttp(409), MESSAGES_TERMINER, false).nature).toBe('disparu');
    expect(classerEchecAction(erreurHttp(500), MESSAGES_TERMINER, false)).toEqual({ nature: 'serveur', message: MESSAGES_TERMINER.serveur });
  });

  it('aucun message ne contient de texte technique', () => {
    for (const m of [...Object.values(MESSAGES_DEFINIR), ...Object.values(MESSAGES_TERMINER)]) expect(m).not.toMatch(/detail|traceback|HTTP|undefined|\bnull\b/i);
  });
});

describe('envois : ne lèvent jamais, un seul appel', () => {
  const saisie: SaisieAction = { titre: 'Réparer', description: '', responsableId: SANS_RESPONSABLE, echeance: '' };
  const action = { id: 'a', issue_id: 'i', titre: 'Réparer', statut: 'creee' } as ActionCorrective;

  it('création réussie : renvoie l’action créée et envoie le corps nettoyé', async () => {
    const creer = vi.fn().mockResolvedValue({ data: action });
    const r = await envoyerCreationAction(creer, 'i', saisie);
    expect(r).toEqual({ type: 'succes', action });
    expect(creer).toHaveBeenCalledTimes(1);
    expect(creer).toHaveBeenCalledWith('i', { titre: 'Réparer' });
  });

  it('création refusée (403) : échec classé, aucune exception', async () => {
    const r = await envoyerCreationAction(vi.fn().mockRejectedValue(erreurHttp(403)), 'i', saisie);
    expect(r).toEqual({ type: 'echec', nature: 'refus', message: MESSAGES_DEFINIR.refus });
  });

  it('terminaison : succès puis échec 500', async () => {
    const terminer = vi.fn().mockResolvedValue({});
    expect(await envoyerTerminaison(terminer, 'i', 'a')).toEqual({ type: 'succes' });
    expect(terminer).toHaveBeenCalledWith('i', 'a');
    expect(await envoyerTerminaison(vi.fn().mockRejectedValue(erreurHttp(500)), 'i', 'a')).toEqual({ type: 'echec', nature: 'serveur', message: MESSAGES_TERMINER.serveur });
  });
});

describe('état d’une action', () => {
  it('libellés', () => {
    expect(libelleEtatAction('creee')).toBe('À faire');
    expect(libelleEtatAction('terminee')).toBe('Terminée');
    expect(libelleEtatAction('annulee')).toBe('Annulée');
  });
});

describe('boîtes empilées : seule la boîte du dessus réagit à Échap et Tab', () => {
  it('estAuPremierPlan', () => {
    const bas = Symbol('bas');
    const haut = Symbol('haut');
    expect(estAuPremierPlan(bas, [bas])).toBe(true);
    expect(estAuPremierPlan(bas, [bas, haut])).toBe(false);
    expect(estAuPremierPlan(haut, [bas, haut])).toBe(true);
    expect(estAuPremierPlan(bas, [])).toBe(false);
  });
});

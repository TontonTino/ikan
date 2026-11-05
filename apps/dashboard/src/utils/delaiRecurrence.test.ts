import axios, { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import type { KPIResult } from '../types';
import { libelleEvenement } from './filActivite';
import { SEUIL_ECHANTILLON_FAIBLE, etatNonRenseigne, formatKpiSubtitle } from './kpiFormat';
import {
  PHRASE_QUI_DECIDE,
  candidatsOrigine,
  classerEchecDelaiRecurrence,
  delaiModifiable,
  delaiVersIso,
  envoyerDelaiRecurrence,
  jourDuDelai,
  libelleCandidat,
  libelleTroncature,
  peutFixerDelaiRecurrence,
  validerDelai,
} from './delaiRecurrence';

const echec = (status?: number) => new AxiosError('x', 'ERR', undefined, undefined, status ? ({ status, data: { detail: 'texte brut du serveur' } } as never) : undefined);

describe('qui décide', () => {
  it('le CX Manager seul peut fixer le délai et la récurrence', () => {
    expect(peutFixerDelaiRecurrence('cx_manager')).toBe(true);
    expect(peutFixerDelaiRecurrence('agency_manager')).toBe(false);
    expect(peutFixerDelaiRecurrence('admin')).toBe(false);
    expect(peutFixerDelaiRecurrence(undefined)).toBe(false);
  });

  it('la phrase de l’Agency Manager dit qui décide', () => {
    expect(PHRASE_QUI_DECIDE).toContain('CX Manager');
  });

  it('délai modifiable tant que le problème n’est ni résolu ni vérifié', () => {
    for (const s of ['ouverte', 'action_en_cours', 'reouverte'] as const) expect(delaiModifiable(s)).toBe(true);
    for (const s of ['resolue', 'verifiee'] as const) expect(delaiModifiable(s)).toBe(false);
  });
});

describe('validation du délai', () => {
  const detection = '2026-11-01T09:00:00Z';
  it('vide : demande une date', () => expect(validerDelai('', detection)).toMatch(/Choisissez une date/));
  it('format invalide', () => {
    expect(validerDelai('12/11/2026', detection)).toMatch(/date valide/);
    expect(validerDelai('2026-13-45', detection)).toMatch(/date valide/);
  });
  it('avant ou le jour de l’enregistrement à midi UTC : refusé comme le serveur', () => {
    expect(validerDelai('2026-10-30', detection)).toMatch(/postérieur/);
    expect(validerDelai('2026-11-01', '2026-11-01T15:00:00Z')).toMatch(/postérieur/);   // midi UTC du jour < 15:00
  });
  it('postérieur : accepté', () => {
    expect(validerDelai('2026-11-01', detection)).toBeNull();
    expect(validerDelai('2026-12-31', detection)).toBeNull();
  });
  it('envoi à midi UTC ; relecture du jour', () => {
    expect(delaiVersIso('2026-11-12')).toBe('2026-11-12T12:00:00Z');
    expect(jourDuDelai('2026-11-12T12:00:00Z')).toBe('2026-11-12');
    expect(jourDuDelai(null)).toBe('');
    expect(jourDuDelai('pas une date')).toBe('');
  });
});

describe('problèmes proposés comme origine', () => {
  const issue = { id: 'moi', premiere_detection: '2026-11-01T00:00:00Z' };
  const c = (id: string, extra: Record<string, unknown> = {}) => ({ id, titre: `Problème ${id}`, statut: 'resolue', premiere_detection: '2026-10-20T00:00:00Z', issue_origine_id: null, agence_nom: 'Agence Ouaga', ...extra }) as never;

  it('mêmes règles que le serveur : résolu ou vérifié, non récurrent, plus ancien, pas lui-même', () => {
    const liste = [
      c('ok1'), c('ok2', { statut: 'verifiee', premiere_detection: '2026-10-25T00:00:00Z' }),
      c('ouvert', { statut: 'ouverte' }), c('encours', { statut: 'action_en_cours' }), c('rouvert', { statut: 'reouverte' }),
      c('recurrent', { issue_origine_id: 'x' }), c('futur', { premiere_detection: '2026-11-05T00:00:00Z' }), c('moi'),
    ];
    expect(candidatsOrigine(liste, issue).map((x) => x.id)).toEqual(['ok2', 'ok1']);   // du plus récent au plus ancien
  });

  it('libellé : le titre puis l’agence, jamais un identifiant', () => {
    expect(libelleCandidat({ titre: 'Climatisation', agence_nom: 'Agence Ouaga' })).toBe('Climatisation · Agence Ouaga');
    expect(libelleCandidat({ titre: 'Climatisation' })).toBe('Climatisation');
  });

  it('liste tronquée : le dit, avec le vrai total', () => {
    expect(libelleTroncature(200, 340)).toBe('Seuls les 200 problèmes résolus les plus récents sont proposés (sur 340).');
    expect(libelleTroncature(12, 12)).toBeNull();
  });
});

describe('erreurs : classées, texte du serveur jamais affiché', () => {
  it.each([
    [403, 'refus', /Seul le CX Manager/],
    [404, 'disparu', /n’existe plus/],
    [409, 'disparu', /changé entre-temps/],
    [422, 'saisie', /n’est pas acceptée/],
    [400, 'saisie', /n’est pas acceptée/],
    [500, 'serveur', /conservée : réessayez/],
    [503, 'serveur', /conservée : réessayez/],
  ] as const)('HTTP %i → %s', (statut, nature, message) => {
    const r = classerEchecDelaiRecurrence(echec(statut));
    expect(r.nature).toBe(nature);
    expect(r.message).toMatch(message);
    expect(r.message).not.toContain('texte brut du serveur');
  });

  it('réseau coupé : serveur, message de connexion ; erreur inattendue : serveur', () => {
    expect(classerEchecDelaiRecurrence(echec())).toEqual({ nature: 'serveur', message: expect.stringContaining('connexion') });
    expect(classerEchecDelaiRecurrence(new Error('boom')).nature).toBe('serveur');
    expect(axios.isAxiosError(echec(500))).toBe(true);
  });

  it('envoi : transmet la charge, ne lève jamais', async () => {
    const ok = vi.fn().mockResolvedValue({});
    expect(await envoyerDelaiRecurrence(ok, 'i1', { date_limite_sla: '2026-11-12T12:00:00Z' })).toEqual({ type: 'succes' });
    expect(ok).toHaveBeenCalledWith('i1', { date_limite_sla: '2026-11-12T12:00:00Z' });
    const ko = vi.fn().mockRejectedValue(echec(422));
    expect(await envoyerDelaiRecurrence(ko, 'i1', { issue_origine_id: 'x' })).toMatchObject({ type: 'echec', nature: 'saisie' });
  });
});

describe('fil d’activité : les deux nouveaux événements', () => {
  const ev = (type_evenement: string) => ({ type_evenement, ancien_statut: null, nouveau_statut: null, details: 'identifiant secret' }) as never;
  it('phrases lisibles, sans détail ni nom technique', () => {
    expect(libelleEvenement(ev('delai_modifie'))).toEqual({ texte: 'Délai de traitement modifié', detail: null });
    expect(libelleEvenement(ev('recurrence_modifiee'))).toEqual({ texte: 'Lien de récidive modifié', detail: null });
  });
});

describe('indicateurs : de « Non renseigné » à la valeur, sans chiffre trompeur', () => {
  const kpi = (extra: Partial<KPIResult>): KPIResult => ({ code: 'SLA_COMPLIANCE_RATE', label: 'x', unit: 'percent', status: 'ok', value: 100, numerator: 1, denominator: 1, ...extra }) as KPIResult;

  it('sans donnée : « Non renseigné » (délai) ; avec des données : la valeur', () => {
    expect(etatNonRenseigne(kpi({ status: 'no_data', value: null }))?.valeur).toBe('Non renseigné');
    expect(etatNonRenseigne(kpi({ numerator: 3, denominator: 5, value: 60 }))).toBeNull();
  });

  it('récurrence : « Non renseigné » tant qu’aucun lien ; la valeur dès qu’il y en a un', () => {
    expect(etatNonRenseigne(kpi({ code: 'ISSUE_RECURRENCE_RATE', numerator: 0, denominator: 8, value: 0 }))?.valeur).toBe('Non renseigné');
    expect(etatNonRenseigne(kpi({ code: 'ISSUE_RECURRENCE_RATE', numerator: 2, denominator: 8, value: 25 }))).toBeNull();
  });

  it('petit volume : le seuil est 5, en dessous la valeur est accompagnée de sa base', () => {
    expect(SEUIL_ECHANTILLON_FAIBLE).toBe(5);
    expect(formatKpiSubtitle(kpi({ numerator: 1, denominator: 1 }), 30)).toBe('Échantillon faible : 1 sur 1 problème résolu avec un délai');
    expect(formatKpiSubtitle(kpi({ numerator: 3, denominator: 4, value: 75 }), 30)).toBe('Échantillon faible : 3 sur 4 problèmes résolus avec un délai');
    expect(formatKpiSubtitle(kpi({ code: 'ISSUE_RECURRENCE_RATE', numerator: 1, denominator: 3, value: 33.3 }), 30)).toBe('Échantillon faible : 1 récurrent sur 3 problèmes');
  });

  it('à 5 problèmes et plus : sous-titre habituel, pas de mise en garde', () => {
    expect(formatKpiSubtitle(kpi({ numerator: 4, denominator: 5, value: 80 }), 30)).toBe('30 derniers jours');
    expect(formatKpiSubtitle(kpi({ code: 'ISSUE_RECURRENCE_RATE', numerator: 2, denominator: 5, value: 40 }), 30)).toBe('30 derniers jours');
  });

  it('un autre indicateur n’est pas touché', () => {
    expect(formatKpiSubtitle(kpi({ code: 'CSAT', numerator: 1, denominator: 2 }), 30)).toBe('30 derniers jours');
  });
});

import { describe, expect, it } from 'vitest';
import { AVIS_STATUT_LABELS } from '../../utils/vocabulaire';
import { estAvisPrisEnCharge, libelleStatutAvis } from './alerteLabels';

describe('libelleStatutAvis : statut de traitement d’un avis à risque → libellé français', () => {
  it('en_traitement → « Pris en charge »', () => expect(libelleStatutAvis('en_traitement')).toBe('Pris en charge'));
  it('en_cours → « Action en cours »', () => expect(libelleStatutAvis('en_cours')).toBe('Action en cours'));
  it('nouveau → rien (l’absence de mention veut dire « pas encore pris en charge »)', () => expect(libelleStatutAvis('nouveau')).toBeNull());
  it('resolu → rien (ces avis ne sont pas dans la liste)', () => expect(libelleStatutAvis('resolu')).toBeNull());
  it.each(['recontacte', 'escalade', 'ferme', '', 'EN_TRAITEMENT', 'inconnu', 'constructor', 'hasOwnProperty', '__proto__'])('valeur héritée ou inconnue « %s » → rien', (v) => {
    expect(libelleStatutAvis(v)).toBeNull();
  });
  it('null et absent → rien', () => {
    expect(libelleStatutAvis(null)).toBeNull();
    expect(libelleStatutAvis(undefined)).toBeNull();
  });
  it('jamais une valeur brute : le libellé n’est jamais la valeur reçue', () => {
    for (const v of ['en_traitement', 'en_cours']) expect(libelleStatutAvis(v)).not.toBe(v);
  });
});

describe('estAvisPrisEnCharge', () => {
  it('« Pris en charge » et « Action en cours » comptent ; le reste non', () => {
    expect(['nouveau', 'en_traitement', 'en_cours', 'resolu', 'recontacte', null, undefined, ''].map(estAvisPrisEnCharge)).toEqual([false, true, true, false, false, false, false, false]);
  });
});

describe('une seule table de libellés pour toute l’application', () => {
  it('la page Alertes affiche exactement ceux de AVIS_STATUT_LABELS (« Pris en charge », « Action en cours »)', () => {
    expect(libelleStatutAvis('en_traitement')).toBe(AVIS_STATUT_LABELS.en_traitement);
    expect(libelleStatutAvis('en_cours')).toBe(AVIS_STATUT_LABELS.en_cours);
    expect([AVIS_STATUT_LABELS.en_traitement, AVIS_STATUT_LABELS.en_cours]).toEqual(['Pris en charge', 'Action en cours']);
  });
});

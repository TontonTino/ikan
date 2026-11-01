// CX-01 : affichage des indicateurs du siège — formatage, évolutions, absence de données (fonctions pures de siegeData.ts).
import { describe, expect, it } from 'vitest';
import type { StatKPI } from '../../../types';
import { compteDefavorableDelta, satisfactionDelta, satisfactionTexte, volumeDelta } from './siegeData';

const kpi = (valeur_num: number | null, valeur_precedente: number | null): StatKPI =>
  ({ status: valeur_num == null ? 'no_data' : 'ok', valeur: valeur_num, valeur_num, valeur_precedente, evolution: null, is_positive: true } as StatKPI);

describe('CSAT du siège : texte affiché', () => {
  it("pourcentage au format français, « Pas d'avis » plutôt que 0 %", () => {
    expect(satisfactionTexte(50, 8)).toBe('50 %');
    expect(satisfactionTexte(66.7, 3)).toBe('66,7 %');
    expect(satisfactionTexte(100, 1)).toBe('100 %');
    expect(satisfactionTexte(0, 4)).toBe('0 %');               // 4 avis, aucun satisfait : 0 % est une vraie valeur
    expect(satisfactionTexte(0, 0)).toBe("Pas d'avis");         // aucun avis : jamais « 0 % »
    expect(satisfactionTexte(null, 0)).toBe("Pas d'avis");
    expect(satisfactionTexte(null, 5)).toBe("Pas d'avis");
  });
});

describe('évolution du CSAT en points', () => {
  it('baisse défavorable : signe moins typographique et virgule décimale', () => {
    expect(satisfactionDelta(kpi(50, 75), kpi(8, 4))).toEqual({ text: '−25 pts', direction: 'down', isPositive: false });
    expect(satisfactionDelta(kpi(50, 66.7), kpi(2, 3))).toEqual({ text: '−16,7 pts', direction: 'down', isPositive: false });
  });
  it('hausse favorable et stabilité', () => {
    expect(satisfactionDelta(kpi(58.3, 0), kpi(12, 1))).toEqual({ text: '+58,3 pts', direction: 'up', isPositive: true });
    expect(satisfactionDelta(kpi(50, 50), kpi(2, 2))).toEqual({ text: '0 pts', direction: 'flat', isPositive: true });
  });
  it('aucune comparaison sans avis sur l’une des deux périodes (jamais un faux zéro)', () => {
    expect(satisfactionDelta(kpi(50, 75), kpi(8, 0))).toBeNull();            // période précédente sans avis
    expect(satisfactionDelta(kpi(null, 75), kpi(0, 4))).toBeNull();          // période courante sans avis
    expect(satisfactionDelta(kpi(50, null), kpi(8, 4))).toBeNull();
    expect(satisfactionDelta(undefined, kpi(8, 4))).toBeNull();
    expect(satisfactionDelta(kpi(50, 75), undefined)).toBeNull();
  });
});

describe('évolution du nombre d’avis en pourcentage', () => {
  it('+100 % (4 → 8) et −33,3 % (3 → 2) ; la variation de volume n’est jamais rouge', () => {
    expect(volumeDelta(kpi(8, 4))).toEqual({ text: '+100 %', direction: 'up', isPositive: true });
    expect(volumeDelta(kpi(2, 3))).toEqual({ text: '−33,3 %', direction: 'down', isPositive: true });
    expect(volumeDelta(kpi(5, 5))).toEqual({ text: '0 %', direction: 'flat', isPositive: true });
  });
  it('grands nombres au format français et base nulle : pas de comparaison', () => {
    expect(volumeDelta(kpi(1300, 100))?.text).toMatch(/^\+1[\s  ]200 %$/);
    expect(volumeDelta(kpi(8, 0))).toBeNull();
    expect(volumeDelta(kpi(8, null))).toBeNull();
    expect(volumeDelta(undefined)).toBeNull();
  });
});

describe('évolution des avis critiques : plus d’avis critiques est défavorable', () => {
  it('+1 (1 → 2) défavorable, −2 favorable, 0 stable', () => {
    expect(compteDefavorableDelta(kpi(2, 1), 4)).toEqual({ text: '+1', direction: 'up', isPositive: false });
    expect(compteDefavorableDelta(kpi(1, 3), 4)).toEqual({ text: '−2', direction: 'down', isPositive: true });
    expect(compteDefavorableDelta(kpi(2, 2), 4)).toEqual({ text: '0', direction: 'flat', isPositive: true });
  });
  it('aucune comparaison si la période précédente n’a aucun avis', () => {
    expect(compteDefavorableDelta(kpi(2, 0), 0)).toBeNull();
    expect(compteDefavorableDelta(kpi(2, 1), null)).toBeNull();
    expect(compteDefavorableDelta(undefined, 4)).toBeNull();
    expect(compteDefavorableDelta(kpi(2, null), 4)).toBeNull();
  });
});

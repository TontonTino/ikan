import { describe, expect, it } from 'vitest';
import type { StatKPI } from '../types';
import { TEXTE_SANS_DONNEES_AVANT, presenterEvolution } from './evolution';

const kpi = (evolution: string | null, surcharge: Partial<StatKPI> = {}): StatKPI => ({
  status: 'ok', valeur: 10, valeur_num: 10, valeur_precedente: 8, evolution, is_positive: true, ...surcharge,
});

describe('évolution par rapport à la période précédente', () => {
  it('hausse : flèche portée par le sens, signe + et valeur, virgule française', () => {
    expect(presenterEvolution(kpi('+16.7 pts'), 2)).toEqual({ etat: 'evolution', sens: 'hausse', valeur: '+16,7 pts', favorable: true });
    expect(presenterEvolution(kpi('+50.0%'), 2)).toEqual({ etat: 'evolution', sens: 'hausse', valeur: '+50,0 %', favorable: true });
  });

  it('baisse : signe moins typographique et valeur, favorable ou non selon l’API', () => {
    expect(presenterEvolution(kpi('-100.0 pts', { is_positive: false }), 1)).toEqual({ etat: 'evolution', sens: 'baisse', valeur: '−100,0 pts', favorable: false });
    expect(presenterEvolution(kpi('−12.5%', { is_positive: false }), 4)).toMatchObject({ sens: 'baisse', valeur: '−12,5 %' });
  });

  it('stable : ni flèche trompeuse ni faux signe', () => {
    const e = presenterEvolution(kpi('+0.0%'), 1);
    expect(e).toMatchObject({ etat: 'evolution', sens: 'stable' });
    expect((e as { valeur: string }).valeur).toContain('stable');
    expect((e as { valeur: string }).valeur).not.toMatch(/^[+−]/);
    expect(presenterEvolution(kpi('+0.0 pts'), 3)).toMatchObject({ sens: 'stable' });
  });

  it('période précédente sans avis : « Pas de données avant », jamais 0 ni NaN', () => {
    expect(TEXTE_SANS_DONNEES_AVANT).toBe('Pas de données avant');
    expect(presenterEvolution(kpi(null, { valeur_precedente: null }), 0)).toEqual({ etat: 'sans_donnees_avant' });
    expect(presenterEvolution(kpi('+50.0%'), 0)).toEqual({ etat: 'sans_donnees_avant' });   // même si une évolution était fournie
    expect(presenterEvolution(kpi(null), 5)).toEqual({ etat: 'sans_donnees_avant' });        // division par zéro côté API : pas d'évolution
  });

  it('rien à comparer : ancien serveur, valeur actuelle absente, texte inattendu', () => {
    expect(presenterEvolution(undefined, 3)).toEqual({ etat: 'indisponible' });
    expect(presenterEvolution(kpi('+3.0 pts'), undefined)).toEqual({ etat: 'indisponible' });
    expect(presenterEvolution(kpi(null, { status: 'no_data', valeur: null, valeur_num: null }), 4)).toEqual({ etat: 'indisponible' });
    for (const bizarre of ['NaN pts', 'Infinity%', '+% ', 'beaucoup', '+--3 pts']) {
      expect(presenterEvolution(kpi(bizarre), 2)).toEqual({ etat: 'indisponible' });
    }
  });

  it('un seul avis de chaque côté : l’évolution est affichée telle que l’API la calcule', () => {
    expect(presenterEvolution(kpi('-100.0 pts', { is_positive: false }), 1)).toMatchObject({ sens: 'baisse', valeur: '−100,0 pts' });
  });
});

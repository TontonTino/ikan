import { describe, expect, it } from 'vitest';
import type { EvolutionPoint } from '../types';
import { insererPeriodesSansAvis, libelleDatePoint } from './satisfactionSeries';

const point = (date: string, satisfaction: number, feedbacks = 1): EvolutionPoint => ({
  date,
  label: date,
  feedbacks,
  traites: 0,
  satisfaction,
  positifs: satisfaction === 0 ? 0 : feedbacks,
  neutres: 0,
  negatifs: satisfaction === 0 ? feedbacks : 0,
});

describe('série de satisfaction', () => {
  it('conserve un vrai 0 % et insère une coupure pour une journée sans avis', () => {
    const serie = insererPeriodesSansAvis([
      point('2026-10-10', 0, 3),
      point('2026-10-12', 100, 2),
    ]);

    expect(serie.map((p) => p.satisfaction)).toEqual([0, null, 100]);
    expect(serie[1]).toMatchObject({ date: '2026-10-11', sansAvis: true, feedbacks: 0 });
    expect(serie[0].feedbacks).toBe(3);
  });

  it('insère une coupure entre les semaines ISO manquantes, y compris au changement d’année', () => {
    const serie = insererPeriodesSansAvis([
      point('2025-W52', 20),
      point('2026-W02', 80),
    ]);

    expect(serie.map((p) => p.date)).toEqual(['2025-W52', '2026-W01', '2026-W02']);
    expect(serie[1].satisfaction).toBeNull();
  });

  it('conserve la date dans les buckets horaires et présente une date lisible au survol', () => {
    const serie = insererPeriodesSansAvis([
      point('2026-10-12-23', 40),
      point('2026-10-13-01', 60),
    ]);

    expect(serie.map((p) => p.date)).toEqual(['2026-10-12-23', '2026-10-13-00', '2026-10-13-01']);
    expect(serie[1].satisfaction).toBeNull();
    expect(libelleDatePoint('2026-10-13-01', '13/10 01h')).toBe('13/10/2026 · 01h');
  });

  it('explicite l’intervalle d’une semaine et la date exacte d’un jour', () => {
    expect(libelleDatePoint('2026-W01', 'Sem 1')).toBe('Sem 1 · 29/12–04/01 2026');
    expect(libelleDatePoint('2026-10-13', '13/10')).toBe('13/10/2026');
  });
});

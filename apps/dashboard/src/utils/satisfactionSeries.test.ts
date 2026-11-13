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
    // Lot 6 : le trou porte la date de son lundi, comme les points de l'API, jamais « Sem 1 ».
    expect(serie[1].label).toBe('29 déc.');
  });

  it('un trou prend l’année quand les libellés de l’API la portent (série sur deux années)', () => {
    const serie = insererPeriodesSansAvis([
      { ...point('2025-W52', 20), label: '22 déc. 2025' },
      { ...point('2026-W02', 80), label: '5 janv. 2026' },
    ]);
    expect(serie[1].label).toBe('29 déc. 2025');
  });

  it('un jour manquant se lit « 11 oct. », comme les jours de l’API', () => {
    const serie = insererPeriodesSansAvis([point('2026-10-10', 50), point('2026-10-12', 50)]);
    expect(serie[1].label).toBe('11 oct.');
  });

  it('conserve la date dans les buckets horaires et présente une date lisible au survol', () => {
    const serie = insererPeriodesSansAvis([
      point('2026-10-12-23', 40),
      point('2026-10-13-01', 60),
    ]);

    expect(serie.map((p) => p.date)).toEqual(['2026-10-12-23', '2026-10-13-00', '2026-10-13-01']);
    expect(serie[1].satisfaction).toBeNull();
    expect(libelleDatePoint('2026-10-13-01', '01h')).toBe('13 oct. 2026 · 01h');
  });

  it('explicite l’intervalle d’une semaine en dates (jamais son numéro) et la date exacte d’un jour', () => {
    expect(libelleDatePoint('2026-W32', '3 août')).toBe('Semaine du 3 au 9 août 2026');
    expect(libelleDatePoint('2026-W36', '31 août')).toBe('Semaine du 31 août au 6 sept. 2026');
    expect(libelleDatePoint('2026-W01', '29 déc.')).toBe('Semaine du 29 déc. 2025 au 4 janv. 2026');
    expect(libelleDatePoint('2026-10-13', '13 oct.')).toBe('13 oct. 2026');
    expect(libelleDatePoint('2026-W32', '3 août')).not.toMatch(/Sem\b|S\d/);
  });
});

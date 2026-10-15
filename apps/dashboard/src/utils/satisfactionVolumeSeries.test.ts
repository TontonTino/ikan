import { describe, expect, it } from 'vitest';
import type { EvolutionPoint } from '../types';
import { combinerSatisfactionEtVolume } from './satisfactionSeries';

const point = (date: string, satisfaction: number, feedbacks: number, traites = 0): EvolutionPoint => ({
  date,
  label: date,
  feedbacks,
  traites,
  satisfaction,
  positifs: 0,
  neutres: 0,
  negatifs: 0,
});

describe('series de satisfaction et de volume', () => {
  it('aligne les volumes observés et conserve les périodes sans avis en null', () => {
    const result = combinerSatisfactionEtVolume(
      [point('2026-10-10', 0, 3), point('2026-10-12', 100, 2)],
      [point('2026-10-12', 100, 2, 1)],
    );

    expect(result.map(({ date, satisfaction, recus, traites }) => ({ date, satisfaction, recus, traites }))).toEqual([
      { date: '2026-10-10', satisfaction: 0, recus: 0, traites: 0 },
      { date: '2026-10-11', satisfaction: null, recus: null, traites: null },
      { date: '2026-10-12', satisfaction: 100, recus: 2, traites: 1 },
    ]);
  });
});

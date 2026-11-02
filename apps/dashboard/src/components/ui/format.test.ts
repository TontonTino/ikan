import { describe, expect, it } from 'vitest';
import { LIMITE_DATE_RELATIVE_JOURS, dateRelativeOuAbsolue } from './format';

describe('dateRelativeOuAbsolue : relatif jusqu’à 30 jours inclus, puis date française absolue', () => {
  const maintenant = new Date('2026-11-02T12:00:00Z');
  const il_y_a = (jours: number, heures = 0) => new Date(maintenant.getTime() - (jours * 24 + heures) * 3_600_000).toISOString();

  it('la limite est de 30 jours', () => expect(LIMITE_DATE_RELATIVE_JOURS).toBe(30));
  it('3 jours : relatif', () => expect(dateRelativeOuAbsolue(il_y_a(3), maintenant)).toBe('il y a 3 jours'));
  it('quelques heures : relatif', () => expect(dateRelativeOuAbsolue(il_y_a(0, 5), maintenant)).toBe('il y a 5 heures'));
  it('27 jours : relatif', () => expect(dateRelativeOuAbsolue(il_y_a(27), maintenant)).toBe('il y a 27 jours'));
  it('30 jours exactement : encore relatif (limite incluse)', () => expect(dateRelativeOuAbsolue(il_y_a(30), maintenant)).toBe('il y a 30 jours'));
  it('30 jours et une heure : absolu', () => expect(dateRelativeOuAbsolue(il_y_a(30, 1), maintenant)).toBe('3 oct. 2026'));
  it('plus de 30 jours : date absolue française', () => expect(dateRelativeOuAbsolue('2026-10-01T08:00:00Z', maintenant)).toBe('1 oct. 2026'));
  it('un an plus tôt : date absolue', () => expect(dateRelativeOuAbsolue('2025-03-04T08:00:00Z', maintenant)).toBe('4 mars 2025'));
  it('date invalide : vide, jamais « Invalid Date »', () => expect(dateRelativeOuAbsolue('pas une date', maintenant)).toBe(''));
});

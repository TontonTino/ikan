import { describe, expect, it } from 'vitest';
import { jourComplet, jourRelatifOuAbsolu, lireJour } from './dateJour';

const MAINTENANT = new Date(2026, 10, 3, 15, 30);       // 3 novembre 2026, heure locale

describe('dates au jour (séries journalières)', () => {
  it('une date sans heure est un jour du calendrier local, jamais décalé par un fuseau', () => {
    const d = lireJour('2026-10-12')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 12, 0]);
  });

  it('relatif jusqu’à 30 jours inclus : Aujourd’hui, Hier, il y a N jours', () => {
    expect(jourRelatifOuAbsolu('2026-11-03', MAINTENANT)).toBe('Aujourd’hui');
    expect(jourRelatifOuAbsolu('2026-11-02', MAINTENANT)).toBe('Hier');
    expect(jourRelatifOuAbsolu('2026-10-29', MAINTENANT)).toBe('il y a 5 jours');
    expect(jourRelatifOuAbsolu('2026-10-04', MAINTENANT)).toBe('il y a 30 jours');
  });

  it('au-delà de 30 jours : « 12 oct. 2026 »', () => {
    expect(jourRelatifOuAbsolu('2026-10-03', MAINTENANT)).toBe('3 oct. 2026');
    expect(jourRelatifOuAbsolu('2026-09-12', MAINTENANT)).toBe('12 sept. 2026');
    expect(jourRelatifOuAbsolu('2025-01-05', MAINTENANT)).toBe('5 janv. 2025');
  });

  it('jamais d’ISO brute ni de « dans N jours » : invalide = vide, futur = date absolue', () => {
    expect(jourRelatifOuAbsolu('pas une date', MAINTENANT)).toBe('');
    expect(jourRelatifOuAbsolu('', MAINTENANT)).toBe('');
    expect(jourRelatifOuAbsolu('2026-11-10', MAINTENANT)).toBe('10 nov. 2026');
  });

  it('date complète pour le survol', () => {
    expect(jourComplet('2026-10-12')).toBe('12 octobre 2026');
    expect(jourComplet('nope')).toBe('');
  });
});

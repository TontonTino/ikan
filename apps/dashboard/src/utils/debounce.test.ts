import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELAI_RECHERCHE_MS, creerDebounce } from './debounce';

describe('recherche différée (300 ms)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('le délai est de 300 ms', () => {
    expect(DELAI_RECHERCHE_MS).toBe(300);
  });

  it("n'appelle rien avant la fin du délai, puis une seule fois", () => {
    const envoyer = vi.fn();
    const differee = creerDebounce(envoyer, DELAI_RECHERCHE_MS);
    differee('a');
    vi.advanceTimersByTime(299);
    expect(envoyer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(envoyer).toHaveBeenCalledWith('a');
  });

  it('une frappe continue ne produit qu’un envoi, avec la dernière valeur', () => {
    const envoyer = vi.fn();
    const differee = creerDebounce(envoyer, DELAI_RECHERCHE_MS);
    for (const saisie of ['r', 're', 'rem', 'remb']) {
      differee(saisie);
      vi.advanceTimersByTime(200); // toujours moins de 300 ms entre deux frappes
    }
    expect(envoyer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(envoyer).toHaveBeenCalledWith('remb');
  });

  it('annuler empêche l’envoi (changement de page ou démontage)', () => {
    const envoyer = vi.fn();
    const differee = creerDebounce(envoyer, DELAI_RECHERCHE_MS);
    differee('x');
    differee.annuler();
    vi.advanceTimersByTime(1000);
    expect(envoyer).not.toHaveBeenCalled();
  });
});

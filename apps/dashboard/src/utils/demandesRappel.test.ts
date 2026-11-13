import { describe, expect, it } from 'vitest';
import { anciennete, jourRelatifOuAbsolu } from './dateJour';
import { demandeEnRetard } from './fileATraiter';

const MAINTENANT = new Date('2026-11-13T12:00:00');
const ilYA = (heures: number) => new Date(MAINTENANT.getTime() - heures * 3600 * 1000).toISOString();

describe('ancienneté d’une demande de rappel (lot 6)', () => {
  it('« il y a 35 jours » : le nombre de jours, même au-delà de 30', () => {
    expect(anciennete('2026-10-09T09:00:00', MAINTENANT)).toBe('il y a 35 jours');
    // La convention des DATES bascule en absolu après 30 jours ; l'ancienneté, non.
    expect(jourRelatifOuAbsolu('2026-10-09T09:00:00', MAINTENANT)).not.toContain('il y a');
  });

  it('aujourd’hui, hier, il y a 2 jours', () => {
    expect(anciennete('2026-11-13T08:00:00', MAINTENANT)).toBe('aujourd’hui');
    expect(anciennete('2026-11-12T23:00:00', MAINTENANT)).toBe('hier');
    expect(anciennete('2026-11-11T10:00:00', MAINTENANT)).toBe('il y a 2 jours');
  });

  it('date invalide ou future : vide', () => {
    expect(anciennete('pas une date', MAINTENANT)).toBe('');
    expect(anciennete('2026-11-20T08:00:00', MAINTENANT)).toBe('');
  });
});

describe('demande en retard : plus de 48 h sans être traitée (même délai que les avis, lot 3)', () => {
  it('au-delà de 48 h en attente : en retard', () => {
    expect(demandeEnRetard({ traitee: false, date_demande: ilYA(49) }, MAINTENANT)).toBe(true);
    expect(demandeEnRetard({ traitee: false, date_demande: ilYA(47) }, MAINTENANT)).toBe(false);
  });

  it('une demande traitée n’est jamais en retard ; une date invalide non plus', () => {
    expect(demandeEnRetard({ traitee: true, date_demande: ilYA(500) }, MAINTENANT)).toBe(false);
    expect(demandeEnRetard({ traitee: false, date_demande: 'pas une date' }, MAINTENANT)).toBe(false);
  });
});

describe('page des demandes de rappel : câblage (source, pas d’environnement DOM)', () => {
  it('une demande en attente montre son ancienneté, la date exacte au survol', async () => {
    const { default: source } = await import('../pages/agency/DemandesRappelPage.tsx?raw');
    expect(source).toContain('<time dateTime={d.date_demande} title={jourComplet(d.date_demande)}>{anciennete(d.date_demande)}</time>');
  });

  it('une demande en retard est marquée comme un avis en retard : trait (classe is-late) ET phrase', async () => {
    const { default: source } = await import('../pages/agency/DemandesRappelPage.tsx?raw');
    expect(source).toContain("className={`demande-rappel${enRetard ? ' is-late' : ''}`}");
    expect(source).toContain('{enRetard && <span className="demande-rappel__retard">En attente depuis plus de 48 h</span>}');
  });
});

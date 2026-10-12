import { describe, expect, it } from 'vitest';
import {
  correspondAuGroupe,
  estUrgent,
  etatDelai,
  libelleJours,
  prochainGeste,
  trierParUrgence,
  type SuiviIssue,
} from './issueSuivi';

const NOW = new Date('2026-10-10T12:00:00Z').getTime();
const base: SuiviIssue = { statut: 'ouverte', severite: 'moyenne', premiere_detection: '2026-10-01T00:00:00Z' };

describe('issueSuivi', () => {
  it('ne produit aucun état de délai sans date limite', () => {
    expect(etatDelai(base, NOW)).toBeNull();
  });

  it('détecte un délai dépassé tant que le problème reste à traiter', () => {
    const issue = { ...base, date_limite_sla: '2026-10-07T12:00:00Z' };
    expect(etatDelai(issue, NOW)).toMatchObject({ etat: 'depasse', jours: 3 });
    expect(etatDelai({ ...issue, statut: 'resolue' }, NOW)).toBeNull();
  });

  it('un délai futur est « à venir »', () => {
    expect(etatDelai({ ...base, date_limite_sla: '2026-10-12T12:00:00Z' }, NOW)).toMatchObject({ etat: 'a_venir', jours: 2 });
  });

  it('met en évidence délai dépassé ou gravité critique, jamais un problème clos', () => {
    expect(estUrgent({ ...base, severite: 'critique' }, NOW)).toBe(true);
    expect(estUrgent({ ...base, date_limite_sla: '2026-10-01T00:00:00Z' }, NOW)).toBe(true);
    expect(estUrgent({ ...base, severite: 'critique', statut: 'verifiee' }, NOW)).toBe(false);
    expect(estUrgent(base, NOW)).toBe(false);
  });

  it('trie les plus urgents d’abord, puis les plus anciens', () => {
    const faibleAncien = { ...base, severite: 'faible' as const, premiere_detection: '2026-09-01T00:00:00Z' };
    const critique = { ...base, severite: 'critique' as const };
    const depasse = { ...base, date_limite_sla: '2026-10-05T00:00:00Z' };
    const verifie = { ...base, statut: 'verifiee' as const, severite: 'critique' as const };
    const tries = trierParUrgence([verifie, faibleAncien, critique, depasse], NOW);
    expect(tries).toEqual([depasse, critique, faibleAncien, verifie]);
  });

  it('filtre par groupe de statuts', () => {
    expect(correspondAuGroupe('reouverte', 'en_attente')).toBe(true);
    expect(correspondAuGroupe('resolue', 'en_attente')).toBe(false);
    expect(correspondAuGroupe('resolue', 'a_verifier')).toBe(true);
    expect(correspondAuGroupe('verifiee', 'verifies')).toBe(true);
    expect(correspondAuGroupe('verifiee', 'tous')).toBe(true);
  });

  it('formule les durées et le prochain geste', () => {
    expect(libelleJours(0)).toBe('aujourd’hui');
    expect(libelleJours(1)).toBe('1 jour');
    expect(libelleJours(12)).toBe('12 jours');
    expect(prochainGeste('resolue')).toMatch(/vérifier/);
  });
});

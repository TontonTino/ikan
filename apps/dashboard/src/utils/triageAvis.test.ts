import { describe, expect, it } from 'vitest';
import type { Feedback } from '../types';
import { aCriticiteElevee, aDiscordance, aSurveiller, aTraiter, compterTriage, estNegatif } from './triageAvis';

const avis = (surcharge: Record<string, unknown> = {}): Feedback =>
  ({ id: 'x', note: 5, statut_traitement: 'nouveau', analyse_ia: undefined, ...surcharge } as unknown as Feedback);

describe('triage des avis — définitions distinctes', () => {
  it('négatif : note faible OU ton négatif (règles des alertes), indépendamment de la criticité', () => {
    expect(estNegatif(avis({ note: 2 }))).toBe(true);
    expect(estNegatif(avis({ note: 5, analyse_ia: { sentiment: 'negatif' } }))).toBe(true);
    expect(estNegatif(avis({ note: 5, analyse_ia: { sentiment: 'negative' } }))).toBe(true);
    expect(estNegatif(avis({ note: 3, analyse_ia: { sentiment: 'neutre', criticite: 'critique' } }))).toBe(false);
  });

  it('criticité élevée ou critique : classification IA uniquement (pas la note)', () => {
    expect(aCriticiteElevee(avis({ analyse_ia: { criticite: 'critique' } }))).toBe(true);
    expect(aCriticiteElevee(avis({ analyse_ia: { criticite: 'elevee' } }))).toBe(true);
    expect(aCriticiteElevee(avis({ analyse_ia: { criticite: 'moyenne' } }))).toBe(false);
    expect(aCriticiteElevee(avis({ note: 1 }))).toBe(false);
  });

  it('à surveiller : au moins un critère ; un avis qui n’en a aucun n’y est pas', () => {
    expect(aSurveiller(avis({ note: 1 }))).toBe(true);
    expect(aSurveiller(avis({ analyse_ia: { criticite: 'elevee' } }))).toBe(true);
    expect(aSurveiller(avis({ analyse_ia: { discordance_detectee: true } }))).toBe(true);
    expect(aSurveiller(avis({ note: 5, analyse_ia: { sentiment: 'positif', criticite: 'faible' } }))).toBe(false);
  });

  it('un avis analysé par l’IA mais sans signal n’est pas à surveiller', () => {
    expect(aSurveiller(avis({ note: 4, statut_traitement: 'nouveau', analyse_ia: { sentiment: 'positif', criticite: 'faible' } }))).toBe(false);
  });

  it('à traiter : non résolu ou demande de rappel en attente ; un avis résolu sans rappel ne l’est pas', () => {
    expect(aTraiter(avis({ statut_traitement: 'nouveau' }))).toBe(true);
    expect(aTraiter(avis({ statut_traitement: 'en_traitement' }))).toBe(true);
    expect(aTraiter(avis({ statut_traitement: 'resolu' }))).toBe(false);
    expect(aTraiter(avis({ statut_traitement: 'resolu', demande_contact: { traitee: false } as never }))).toBe(true);
    expect(aTraiter(avis({ statut_traitement: 'resolu', demande_contact: { traitee: true } as never }))).toBe(false);
  });
});

describe('compteurs de triage — aucun double comptage', () => {
  const jeu = [
    avis({ note: 1, analyse_ia: { sentiment: 'negatif', criticite: 'critique', discordance_detectee: false } }),   // 3 critères
    avis({ note: 5, analyse_ia: { sentiment: 'negatif', criticite: 'elevee', discordance_detectee: true } }),      // 3 critères
    avis({ note: 3, analyse_ia: { sentiment: 'neutre', criticite: 'moyenne' } }),                                   // aucun
    avis({ note: 2, analyse_ia: { sentiment: 'neutre', criticite: 'faible' } }),                                    // 1 critère (note)
    avis({ note: 5, statut_traitement: 'resolu', analyse_ia: { sentiment: 'positif', criticite: 'faible' } }),      // aucun, résolu
  ];

  it('les avis à surveiller sont comptés une seule fois, malgré plusieurs critères', () => {
    const c = compterTriage(jeu);
    expect(c.total).toBe(5);
    expect(c.aSurveiller).toBe(3);
    expect(c.aSurveiller).toBeLessThan(c.negatifs + c.criticiteElevee + c.discordants);
    expect(c.aSurveiller).toBeLessThanOrEqual(c.total);
  });

  it('les catégories restent distinctes et leurs effectifs peuvent différer', () => {
    const c = compterTriage(jeu);
    expect({ negatifs: c.negatifs, criticiteElevee: c.criticiteElevee, discordants: c.discordants, aTraiter: c.aTraiter }).toEqual({ negatifs: 3, criticiteElevee: 2, discordants: 1, aTraiter: 4 });
    expect(aDiscordance(jeu[1])).toBe(true);
  });

  it('liste vide', () => {
    expect(compterTriage([])).toEqual({ total: 0, negatifs: 0, criticiteElevee: 0, discordants: 0, aSurveiller: 0, aTraiter: 0 });
  });
});

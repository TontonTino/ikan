import { describe, expect, it } from 'vitest';
import type { Alerte, AlerteFeedback, Issue, Recommandation, TendanceSatisfaction } from '../../types';
import {
  construirePriorites,
  estProblemePrioritaire,
  grouperRecommandations,
  interpretationEvolution,
  resumeAccessibleEvolution,
  trierRecommandations,
  variationPeriode,
} from './agenceVue';

const alerte = (id = 'a1'): Alerte => ({ agence_id: id, agence_nom: 'Agence', taux_actuel: 55, seuil: 70, message: 'sous le seuil' });
const avis = (id: string, note: number): AlerteFeedback =>
  ({ feedback_id: id, agence_id: 'a1', agence_nom: 'Agence', note, categorie_nom: 'Accueil', raison: 'note_basse', commentaire: 'Attente trop longue', date_soumission: '2026-10-10T10:00:00Z' });
const probleme = (id: string, severite: Issue['severite'], statut: Issue['statut'] = 'ouverte', necessite_action = false): Issue =>
  ({ id, agence_id: 'a1', titre: `Problème ${id}`, statut, severite, necessite_action } as Issue);
const reco = (id: string, priorite: Recommandation['priorite'], date = '2026-10-10T10:00:00Z'): Recommandation =>
  ({ id, analyse_ia_id: 'x', contenu: `reco ${id}`, priorite, date_generation: date, traitee: false, source: 'regle' });
const point = (date: string, taux: number, n = 10): TendanceSatisfaction => ({ date, taux, nombre_feedbacks: n });

describe('priorités de l’agence', () => {
  it('aucune donnée : aucune priorité', () => {
    expect(construirePriorites({ alertes: [], avis: [], problemes: [] })).toEqual([]);
  });

  it('distingue alerte, problème et avis : chacun garde son propre type et son lien', () => {
    const p = construirePriorites({ alertes: [alerte()], avis: [avis('f1', 1)], problemes: [probleme('i1', 'critique')] });
    expect(p.map((x) => x.kind).sort()).toEqual(['avis', 'probleme', 'seuil']);
    expect(p.find((x) => x.kind === 'seuil')!.type).toBe('Alerte de seuil');
    expect(p.find((x) => x.kind === 'probleme')!.type).toBe('Problème à traiter');
    expect(p.find((x) => x.kind === 'avis')!.type).toBe('Avis à examiner');
    expect(p.find((x) => x.kind === 'probleme')!.lien.to).toBe('/issues');
    expect(p.find((x) => x.kind === 'avis')!.lien.to).toBe('/feedbacks?tab=critiques');
  });

  it('les éléments critiques passent avant les autres', () => {
    const p = construirePriorites({ alertes: [], avis: [avis('f3', 3), avis('f1', 1)], problemes: [probleme('i2', 'elevee'), probleme('i1', 'critique')] });
    expect(p[0].ton).toBe('critical');
    const tons = p.map((x) => x.ton);
    expect(tons.indexOf('warning')).toBeGreaterThan(tons.lastIndexOf('critical'));
  });

  it('une alerte de seuil est toujours critique et en tête', () => {
    const p = construirePriorites({ alertes: [alerte()], avis: [avis('f1', 1)], problemes: [probleme('i1', 'critique')] });
    expect(p[0].kind).toBe('seuil');
    expect(p[0].ton).toBe('critical');
  });

  it('avis : une note ≤ 2 est critique, plus basse d’abord', () => {
    const p = construirePriorites({ alertes: [], avis: [avis('b', 2), avis('a', 1), avis('c', 3)], problemes: [] });
    expect(p.map((x) => x.id)).toEqual(['avis-a', 'avis-b', 'avis-c']);
    expect(p.map((x) => x.ton)).toEqual(['critical', 'critical', 'warning']);
  });

  it('problèmes : seuls les problèmes ouverts graves ou nécessitant une action sont prioritaires', () => {
    expect(estProblemePrioritaire(probleme('1', 'critique'))).toBe(true);
    expect(estProblemePrioritaire(probleme('2', 'elevee', 'reouverte'))).toBe(true);
    expect(estProblemePrioritaire(probleme('3', 'faible', 'ouverte', true))).toBe(true);
    expect(estProblemePrioritaire(probleme('4', 'faible'))).toBe(false);
    expect(estProblemePrioritaire(probleme('5', 'critique', 'resolue'))).toBe(false);
    expect(estProblemePrioritaire(probleme('6', 'critique', 'verifiee'))).toBe(false);
  });

  it('problèmes : critique avant élevée', () => {
    const p = construirePriorites({ alertes: [], avis: [], problemes: [probleme('e', 'elevee'), probleme('c', 'critique')] });
    expect(p.map((x) => x.id)).toEqual(['probleme-c', 'probleme-e']);
  });

  it('n’invente aucun libellé de statut ni de responsable', () => {
    const [p] = construirePriorites({ alertes: [], avis: [], problemes: [probleme('i1', 'critique')] });
    expect(p.detail).toMatch(/Gravité critique/);
    expect(p.detail).not.toMatch(/responsable|échéance/i);
  });
});

describe('recommandations', () => {
  it('tri : priorité décroissante puis plus récentes d’abord', () => {
    const t = trierRecommandations([
      reco('low', 'low'),
      reco('high-ancien', 'high', '2026-10-01T00:00:00Z'),
      reco('crit', 'critical'),
      reco('high-recent', 'high', '2026-10-09T00:00:00Z'),
    ]);
    expect(t.map((r) => r.id)).toEqual(['crit', 'high-recent', 'high-ancien', 'low']);
  });

  it('regroupement par priorité existante, dans l’ordre, sans groupe vide', () => {
    const g = grouperRecommandations([reco('1', 'high'), reco('2', 'critical'), reco('3', 'high')]);
    expect(g.map((x) => [x.priorite, x.items.length])).toEqual([['critical', 1], ['high', 2]]);
    expect(g[0].label).toBe('Critique');
  });

  it('ne modifie pas le tableau d’origine', () => {
    const origine = [reco('1', 'low'), reco('2', 'critical')];
    trierRecommandations(origine);
    expect(origine.map((r) => r.id)).toEqual(['1', '2']);
  });
});

describe('évolution de la satisfaction', () => {
  it('variation : premier au dernier relevé, arrondie à 0,1 point', () => {
    expect(variationPeriode([point('a', 50), point('b', 60.04)])).toBe(10);
    expect(variationPeriode([point('a', 80), point('b', 60)])).toBe(-20);
  });

  it('variation indisponible sous deux relevés', () => {
    expect(variationPeriode([])).toBeNull();
    expect(variationPeriode([point('a', 50)])).toBeNull();
    expect(interpretationEvolution([point('a', 50)])).toMatch(/au moins deux relevés/);
  });

  it('interprétation : progresse, recule ou stable, sans extrapoler', () => {
    expect(interpretationEvolution([point('a', 40), point('b', 55)])).toMatch(/progresse de 15 points/);
    expect(interpretationEvolution([point('a', 60), point('b', 59)])).toMatch(/recule de 1 point /);
    expect(interpretationEvolution([point('a', 60), point('b', 60)])).toMatch(/stable/);
  });

  it('alternative textuelle : bornes, minimum et maximum réels', () => {
    const t = resumeAccessibleEvolution([point('2026-10-01', 40), point('2026-10-02', 90), point('2026-10-03', 70)]);
    expect(t).toContain('3 relevés');
    expect(t).toContain('Premier relevé : 40 %');
    expect(t).toContain('dernier : 70 %');
    expect(t).toContain('Plus bas : 40 % (2026-10-01)');
    expect(t).toContain('plus haut : 90 % (2026-10-02)');
  });

  it('alternative textuelle : aucune donnée', () => {
    expect(resumeAccessibleEvolution([])).toBe('Aucun relevé de satisfaction sur la période.');
  });
});

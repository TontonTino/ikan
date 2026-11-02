import { describe, expect, it } from 'vitest';
import type { Alerte, AlerteFeedback } from '../../types';
import {
  AVIS_VISIBLES,
  avisCible,
  compterAlertes,
  filtrerAlertes,
  messageForfait,
  nombreAvisVisibles,
  sourceInitiale,
  sourceReducer,
  sousTitreAlertes,
  tonAvis,
  trierAvis,
} from './alertesVue';

const seuil = (agence: string): Alerte => ({ agence_id: agence, agence_nom: `Agence ${agence}`, taux_actuel: 50, seuil: 70, message: 'sous le seuil' });
const avis = (id: string, note: number, agence = 'a1', date = '2026-10-10T10:00:00Z'): AlerteFeedback =>
  ({ feedback_id: id, agence_id: agence, agence_nom: `Agence ${agence}`, note, categorie_nom: null, raison: 'note_basse', commentaire: `c ${id}`, date_soumission: date });

describe('gravité et tri des avis à risque', () => {
  it('une note de 2 ou moins est critique, au-delà c’est à surveiller', () => {
    expect(tonAvis(1)).toBe('critical');
    expect(tonAvis(2)).toBe('critical');
    expect(tonAvis(3)).toBe('warning');
  });

  it('critiques d’abord, puis du plus récent au plus ancien', () => {
    const t = trierAvis([
      avis('recent-3', 3, 'a1', '2026-10-10T12:00:00Z'),
      avis('ancien-1', 1, 'a1', '2026-10-01T12:00:00Z'),
      avis('recent-2', 2, 'a1', '2026-10-09T12:00:00Z'),
    ]);
    expect(t.map((a) => a.feedback_id)).toEqual(['recent-2', 'ancien-1', 'recent-3']);
  });

  it('ne modifie pas la liste d’origine', () => {
    const origine = [avis('b', 3), avis('a', 1)];
    trierAvis(origine);
    expect(origine.map((a) => a.feedback_id)).toEqual(['b', 'a']);
  });
});

describe('filtres', () => {
  const S = [seuil('a1'), seuil('a2')];
  const A = [avis('x', 1, 'a1'), avis('y', 4, 'a2')];

  it('type « Satisfaction » : aucun avis ; type « Avis » : aucune alerte de seuil', () => {
    expect(filtrerAlertes({ seuil: S, avis: A, type: 'seuil', agenceId: null }).avis).toEqual([]);
    expect(filtrerAlertes({ seuil: S, avis: A, type: 'avis', agenceId: null }).seuil).toEqual([]);
    expect(filtrerAlertes({ seuil: S, avis: A, type: 'toutes', agenceId: null })).toMatchObject({ seuil: S });
  });

  it('filtre d’agence : applique aux deux types, sans perdre le total hors filtre', () => {
    const f = filtrerAlertes({ seuil: S, avis: A, type: 'toutes', agenceId: 'a2' });
    expect(f.seuil.map((a) => a.agence_id)).toEqual(['a2']);
    expect(f.avis.map((a) => a.feedback_id)).toEqual(['y']);
    expect(compterAlertes(S, A, null).total).toBe(4);
    expect(compterAlertes(S, A, 'a2').total).toBe(2);
  });

  it('compteurs : alertes de seuil, avis et avis critiques', () => {
    expect(compterAlertes(S, A, null)).toEqual({ seuil: 2, avis: 2, critiques: 1, total: 4 });
  });
});

describe('affichage progressif', () => {
  const beaucoup = Array.from({ length: 25 }, (_, i) => avis(`f${i}`, 3));

  it('limite initiale, tout si dépliée, tout si peu d’éléments', () => {
    expect(nombreAvisVisibles(beaucoup, false, null)).toBe(AVIS_VISIBLES);
    expect(nombreAvisVisibles(beaucoup, true, null)).toBe(25);
    expect(nombreAvisVisibles(beaucoup.slice(0, 4), false, null)).toBe(4);
  });

  it('une alerte ciblée par la cloche au-delà de la limite déplie toute la liste', () => {
    expect(nombreAvisVisibles(beaucoup, false, 'f20')).toBe(25);
    expect(nombreAvisVisibles(beaucoup, false, 'f3')).toBe(AVIS_VISIBLES);
    expect(nombreAvisVisibles(beaucoup, false, 'inconnu')).toBe(AVIS_VISIBLES);
  });

  it('identifiant d’avis ciblé extrait de l’ancre de la cloche', () => {
    expect(avisCible('#alerte-feedback-abc-123')).toBe('abc-123');
    expect(avisCible('#alerte-seuil-abc')).toBeNull();
    expect(avisCible('')).toBeNull();
  });
});

describe('état d’une source', () => {
  it('démarre en chargement, sans donnée chargée', () => {
    expect(sourceInitiale([])).toEqual({ statut: 'chargement', donnees: [], charge: false });
  });

  it('succès sans donnée : prêt (liste vide légitime) ; échec sans donnée : erreur, pas « chargé »', () => {
    expect(sourceReducer(sourceInitiale<number[]>([]), { type: 'succes', donnees: [] })).toEqual({ statut: 'pret', donnees: [], charge: true });
    const e = sourceReducer(sourceInitiale<number[]>([]), { type: 'echec' });
    expect(e.statut).toBe('erreur');
    expect(e.charge).toBe(false);
  });

  it('un échec d’actualisation conserve les données déjà chargées', () => {
    const charge = sourceReducer(sourceInitiale<number[]>([]), { type: 'succes', donnees: [1, 2] });
    const apres = sourceReducer(charge, { type: 'echec' });
    expect(apres).toEqual({ statut: 'erreur', donnees: [1, 2], charge: true });
    expect(sourceReducer(apres, { type: 'debut' }).donnees).toEqual([1, 2]);
  });

  it('réessai : erreur, chargement, succès', () => {
    let e = sourceReducer(sourceInitiale<number[]>([]), { type: 'echec' });
    e = sourceReducer(e, { type: 'debut' });
    expect(e.statut).toBe('chargement');
    e = sourceReducer(e, { type: 'succes', donnees: [7] });
    expect(e).toEqual({ statut: 'pret', donnees: [7], charge: true });
  });
});

describe('message de forfait', () => {
  it('CX : nomme le forfait quand il est connu et ne parle pas de bonne satisfaction', () => {
    const m = messageForfait('Gratuit', true);
    expect(m.titre).toBe('Les alertes de satisfaction ne sont pas incluses dans le forfait Gratuit');
    expect(m.detail).toMatch(/pas parce que la satisfaction du réseau est bonne/);
  });

  it('Responsable d’agence : message générique et renvoi vers le CX Manager', () => {
    const m = messageForfait(null, false);
    expect(m.titre).toContain('forfait de votre organisation');
    expect(m.detail).toMatch(/CX Manager/);
  });
});

describe('sousTitreAlertes', () => {
  const cas: Array<[string, { seuil: number; avis: number; critiques: number }, string | null]> = [
    ['rien', { seuil: 0, avis: 0, critiques: 0 }, null],
    ['une alerte de seuil seule', { seuil: 1, avis: 0, critiques: 0 }, '1 alerte de satisfaction'],
    ['plusieurs alertes de seuil seules', { seuil: 3, avis: 0, critiques: 0 }, '3 alertes de satisfaction'],
    ['un avis critique', { seuil: 0, avis: 1, critiques: 1 }, '1 avis à risque (critique : note ≤ 2)'],
    ['un avis non critique', { seuil: 0, avis: 1, critiques: 0 }, '1 avis à risque (non critique : note ≤ 2)'],
    ['tous critiques (plus de « 16 dont 16 »)', { seuil: 0, avis: 16, critiques: 16 }, '16 avis à risque (tous critiques : note ≤ 2)'],
    ['aucun critique', { seuil: 0, avis: 4, critiques: 0 }, '4 avis à risque (aucun critique : note ≤ 2)'],
    ['mélange', { seuil: 2, avis: 10, critiques: 1 }, '2 alertes de satisfaction · 10 avis à risque (dont 1 critique : note ≤ 2)'],
    ['mélange, plusieurs critiques', { seuil: 1, avis: 10, critiques: 3 }, '1 alerte de satisfaction · 10 avis à risque (dont 3 critiques : note ≤ 2)'],
  ];
  it.each(cas)('%s', (_nom, c, attendu) => {
    expect(sousTitreAlertes({ ...c, total: c.seuil + c.avis })).toBe(attendu);
  });
});

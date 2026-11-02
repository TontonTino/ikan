import { describe, expect, it } from 'vitest';
import type { Alerte, AlerteFeedback } from '../../types';
import { formaterNombre } from '../../utils/formatNombre';
import {
  AVIS_VISIBLES,
  avisCible,
  compterAlertes,
  filtrerAlertes,
  libelleVoirAvis,
  messageForfait,
  nombreAvisVisibles,
  sourceInitiale,
  sourceReducer,
  decouperChiffres,
  partiesSynthese,
  phraseAgencesConcernees,
  phraseSynthese,
  syntheseAlertes,
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

describe('syntheseAlertes et phrases', () => {
  const sd = (id: string): Alerte => ({ agence_id: id, agence_nom: id, taux_actuel: 50, seuil: 70, message: '' });
  const av = (id: string, ag: string, note = 1, date = '2026-11-01T10:00:00Z'): AlerteFeedback =>
    ({ feedback_id: id, agence_id: ag, agence_nom: ag, note, categorie_nom: '', raison: 'note_basse', commentaire: '', date_soumission: date });
  const phrase = (seuil: Alerte[], avis: AlerteFeedback[], cx = true, agenceId: string | null = null) => {
    const s = syntheseAlertes({ seuil, avis, agenceId, cx });
    return s && [phraseSynthese(s), phraseAgencesConcernees(s)];
  };

  it('0 : pas de synthèse (jamais « 0 situation »)', () => expect(syntheseAlertes({ seuil: [], avis: [], agenceId: null, cx: true })).toBeNull());
  it('1 alerte de seuil seule : singulier, partie « avis » omise', () => expect(phrase([sd('a')], [])).toEqual(['1 situation à surveiller : 1 alerte de seuil', '1 agence concernée']));
  it('1 avis seul : partie « seuil » omise', () => expect(phrase([], [av('f', 'a')])).toEqual(['1 situation à surveiller : 1 avis à risque', '1 agence concernée']));
  it('plusieurs : pluriels, agences distinctes', () => expect(phrase([sd('a'), sd('b')], [av('f1', 'a'), av('f2', 'c'), av('f3', 'c')])).toEqual(['5 situations à surveiller : 2 alertes de seuil, 3 avis à risque', '3 agences concernées']));
  it('Responsable d’agence : jamais d’agences concernées', () => expect(phrase([sd('a')], [av('f', 'a')], false)).toEqual(['2 situations à surveiller : 1 alerte de seuil, 1 avis à risque', null]));
  it('milliers : format français', () => {
    const s = syntheseAlertes({ seuil: [], avis: Array.from({ length: 1234 }, (_, i) => av(`f${i}`, 'a')), agenceId: null, cx: false })!;
    expect(phraseSynthese(s)).toBe(`${formaterNombre(1234, 0)} situations à surveiller : ${formaterNombre(1234, 0)} avis à risque`);
  });
  it('le filtre d’agence restreint la synthèse', () => expect(phrase([sd('a'), sd('b')], [av('f', 'b')], true, 'b')).toEqual(['2 situations à surveiller : 1 alerte de seuil, 1 avis à risque', '1 agence concernée']));
  it('avis le plus ancien : date valide seulement ; absent sans avis ou sans date exploitable', () => {
    expect(syntheseAlertes({ seuil: [], avis: [av('f1', 'a', 1, '2026-11-01T10:00:00Z'), av('f2', 'a', 1, '2026-10-20T08:00:00Z')], agenceId: null, cx: true })!.avisLePlusAncien).toBe('2026-10-20T08:00:00.000Z');
    expect(syntheseAlertes({ seuil: [sd('a')], avis: [], agenceId: null, cx: true })!.avisLePlusAncien).toBeNull();
    expect(syntheseAlertes({ seuil: [], avis: [av('f', 'a', 1, 'pas une date')], agenceId: null, cx: true })!.avisLePlusAncien).toBeNull();
  });
  it('champ agence manquant : agences concernées omises plutôt que 0', () => expect(phrase([], [av('f', '')])).toEqual(['1 situation à surveiller : 1 avis à risque', null]));
});

describe('mise en valeur des chiffres', () => {
  it('découpe sans rien changer au texte', () => {
    const t = '18 situations à surveiller : 2 alertes de seuil, 16 avis à risque';
    const morceaux = decouperChiffres(t);
    expect(morceaux.map((m) => m.texte).join('')).toBe(t);
    expect(morceaux.filter((m) => m.nombre).map((m) => m.texte)).toEqual(['18', '2', '16']);
  });
  it('un nombre à milliers français reste un seul nombre', () => {
    const t = `${formaterNombre(1234, 0)} avis`;
    expect(decouperChiffres(t).filter((m) => m.nombre)).toHaveLength(1);
  });
  it('parties de la synthèse : titre et détail séparés, sans « : »', () => {
    const s = syntheseAlertes({ seuil: [{ agence_id: 'a', agence_nom: 'a', taux_actuel: 1, seuil: 2, message: '' }], avis: [], agenceId: null, cx: false })!;
    expect(partiesSynthese(s)).toEqual({ titre: '1 situation à surveiller', detail: '1 alerte de seuil' });
  });
});

describe('libellé du bouton « Voir les N avis »', () => {
  it('N réel = avis encore masqués ; singulier ; Réduire une fois dépliée', () => {
    expect(libelleVoirAvis(16, false)).toBe('Voir les 11 avis');
    expect(libelleVoirAvis(7, false)).toBe('Voir les 2 avis');
    expect(libelleVoirAvis(6, false)).toBe('Voir l’avis restant');
    expect(libelleVoirAvis(16, true)).toBe('Réduire');
    expect(libelleVoirAvis(30, false, 10)).toBe('Voir les 20 avis');
  });
});

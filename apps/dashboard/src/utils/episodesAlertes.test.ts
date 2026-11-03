import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import type { Alerte, EpisodeHistorique } from '../types';
import {
  CAUSE_FIN_LABELS,
  COMMENTAIRE_MAX,
  FILTRES_INITIAUX,
  MESSAGE_ALERTE_INTROUVABLE,
  MESSAGE_ALERTE_TERMINEE,
  MESSAGE_DEJA_PRISE_EN_CHARGE,
  caracteresRestants,
  classerEchecPriseEnCharge,
  compteurCommentaire,
  dateJourMois,
  dateRelativeAlerte,
  envoyerPriseEnCharge,
  episodeDeAlerte,
  explicationCauseFin,
  filtresActifs,
  formaterDelaiExact,
  formaterDureeApprox,
  historiqueInitial,
  historiqueReducer,
  libelleCauseFin,
  libelleStatutEpisode,
  nettoyerCommentaire,
  parametresHistorique,
  peutPrendreEnCharge,
  phraseDebutEtFin,
  phraseDuree,
  prefixeDebut,
  segmentsPeriode,
  valeurDuree,
} from './episodesAlertes';

const MAINTENANT = new Date('2026-11-03T12:00:00Z');

const alerte = (s: Partial<Alerte> = {}): Alerte => ({ agence_id: 'a1', agence_nom: 'Agence A1', taux_actuel: 50, seuil: 70, message: 'm', ...s });
const avecEpisode = (s: Partial<Alerte> = {}): Alerte => alerte({
  episode_id: 'ep1', episode_statut: 'detectee', detecte_le: '2026-10-20T08:00:00Z', debut_condition: '2026-10-12T10:00:00Z', debut_approximatif: true, debut_remontee_limitee: false, ...s,
});
const episode = (s: Partial<EpisodeHistorique> = {}): EpisodeHistorique => ({
  episode_id: 'e1', agence_id: 'a1', agence_nom: 'Agence A1', type: 'seuil_satisfaction', statut: 'terminee', gravite_ouverture: 'critique',
  detecte_le: '2026-10-12T10:05:00Z', debut_condition: '2026-10-12T10:00:00Z', debut_approximatif: true, debut_remontee_limitee: false,
  fin_condition: '2026-10-15T09:00:00Z', terminee_le: '2026-10-15T09:05:00Z', fin_cause: 'retablie', duree_minutes: 3 * 24 * 60, duree_approximative: true,
  duree_minimale: false, duree_en_cours: false, taux_ouverture: 50, seuil_ouverture: 70, taux_fermeture: 80, seuil_fermeture: 70, ...s,
});

describe('libellés d’état et de cause de fin', () => {
  it('états', () => {
    expect(libelleStatutEpisode('detectee')).toBe('Détectée');
    expect(libelleStatutEpisode('prise_en_charge')).toBe('Prise en charge');
    expect(libelleStatutEpisode('terminee')).toBe('Terminée');
  });

  it('un état inconnu, vide ou héritant d’Object n’affiche jamais de clé technique', () => {
    for (const v of ['autre', '', null, undefined, 'constructor', 'toString', '__proto__']) expect(libelleStatutEpisode(v)).toBeNull();
  });

  it('les quatre causes de fin, en français', () => {
    expect(libelleCauseFin('retablie')).toBe('Situation rétablie');
    expect(libelleCauseFin('donnees_insuffisantes')).toBe('Données insuffisantes');
    expect(libelleCauseFin('seuil_modifie')).toBe('Seuil modifié');
    expect(libelleCauseFin('agence_desactivee')).toBe('Agence désactivée');
    expect(Object.keys(CAUSE_FIN_LABELS)).toHaveLength(4);
  });

  it('cause inconnue ou absente : rien (jamais la valeur brute)', () => {
    for (const v of ['inconnue', '', null, undefined, 'constructor']) {
      expect(libelleCauseFin(v)).toBeNull();
      expect(explicationCauseFin(v)).toBeNull();
    }
  });

  it('seule « rétablie » est présentée comme une amélioration ; « données insuffisantes » dit que ce n’en est pas une', () => {
    expect(explicationCauseFin('retablie')).toContain('repassée au-dessus du seuil');
    expect(explicationCauseFin('donnees_insuffisantes')).toContain('pas une amélioration');
    expect(explicationCauseFin('seuil_modifie')).not.toContain('améliorat');
  });
});

describe('épisode d’une alerte de la liste', () => {
  it('sans épisode (ancien serveur, interrupteur coupé) : null, l’alerte reste affichée comme avant', () => {
    expect(episodeDeAlerte(alerte())).toBeNull();
    expect(episodeDeAlerte(alerte({ episode_id: null, episode_statut: null }))).toBeNull();
    expect(episodeDeAlerte(alerte({ episode_id: 'x', episode_statut: null }))).toBeNull();
    expect(episodeDeAlerte(alerte({ episode_id: 'x', episode_statut: 'terminee' as never }))).toBeNull();
  });

  it('lit l’état, le début, la prise en charge et le commentaire', () => {
    const e = episodeDeAlerte(avecEpisode({ episode_statut: 'prise_en_charge', pris_en_charge_le: '2026-10-21T08:00:00Z', pris_en_charge_par_nom: ' Awa Traoré ', commentaire_prise_en_charge: ' Rappel prévu ' }));
    expect(e).toMatchObject({ id: 'ep1', statut: 'prise_en_charge', debutApproximatif: true, debutLimite: false, prisEnChargePar: 'Awa Traoré', commentaire: 'Rappel prévu' });
  });

  it('prudence : sans indication, le début reste approximatif ; seul « false » explicite retire la mention', () => {
    expect(episodeDeAlerte(avecEpisode({ debut_approximatif: null }))?.debutApproximatif).toBe(true);
    expect(episodeDeAlerte(avecEpisode({ debut_approximatif: undefined }))?.debutApproximatif).toBe(true);
    expect(episodeDeAlerte(avecEpisode({ debut_approximatif: false }))?.debutApproximatif).toBe(false);
  });

  it('le bouton « Prendre en charge » : Agency Manager SEUL, alerte détectée SEULEMENT', () => {
    expect(peutPrendreEnCharge(avecEpisode(), true)).toBe(true);
    expect(peutPrendreEnCharge(avecEpisode(), false)).toBe(false);                                        // CX Manager : jamais
    expect(peutPrendreEnCharge(avecEpisode({ episode_statut: 'prise_en_charge' }), true)).toBe(false);    // déjà prise en charge
    expect(peutPrendreEnCharge(alerte(), true)).toBe(false);                                              // pas d’épisode
  });
});

describe('dates : le début est toujours « environ » ou « au moins »', () => {
  it('« 12 oct. » (année omise dans l’année en cours), avec l’année sinon', () => {
    expect(dateJourMois('2026-10-12T10:00:00Z', MAINTENANT)).toBe('12 oct.');
    expect(dateJourMois('2025-10-12T10:00:00Z', MAINTENANT)).toBe('12 oct. 2025');
    expect(dateJourMois('pas une date', MAINTENANT)).toBe('');
  });

  it('préfixes : environ (défaut), au moins (début tronqué), exact seulement si le serveur l’affirme', () => {
    expect(prefixeDebut(true, false)).toBe('Depuis environ le');
    expect(prefixeDebut(true, true)).toBe('Depuis au moins le');
    expect(prefixeDebut(false, true)).toBe('Depuis au moins le');
    expect(prefixeDebut(false, false)).toBe('Depuis le');
  });

  it('épisode ouvert : « Depuis environ le 12 oct. » / « Depuis au moins le 12 oct. »', () => {
    const ouvert = episode({ statut: 'detectee', fin_condition: null });
    expect(phraseDebutEtFin(ouvert, MAINTENANT)).toBe('Depuis environ le 12 oct.');
    expect(phraseDebutEtFin({ ...ouvert, debut_remontee_limitee: true }, MAINTENANT)).toBe('Depuis au moins le 12 oct.');
  });

  it('épisode terminé : « Environ du 12 oct. au 15 oct. » ; début tronqué : « Depuis au moins le … jusqu’au … »', () => {
    expect(phraseDebutEtFin(episode(), MAINTENANT)).toBe('Environ du 12 oct. au 15 oct.');
    expect(phraseDebutEtFin(episode({ debut_remontee_limitee: true }), MAINTENANT)).toBe('Depuis au moins le 12 oct., jusqu’au 15 oct.');
  });

  it('les dates des segments portent leur instant (rendues dans <time>)', () => {
    const segments = segmentsPeriode(episode(), MAINTENANT);
    expect(segments.filter((s) => s.iso).map((s) => s.iso)).toEqual(['2026-10-12T10:00:00Z', '2026-10-15T09:00:00Z']);
  });
});

describe('dates relatives des alertes', () => {
  it('sous la minute : « à l’instant », jamais « il y a 0 secondes »', () => {
    expect(dateRelativeAlerte('2026-11-03T11:59:30Z', MAINTENANT)).toBe('à l’instant');
    expect(dateRelativeAlerte('2026-11-03T12:00:20Z', MAINTENANT)).toBe('à l’instant');     // petit décalage d’horloge
    expect(dateRelativeAlerte('2026-11-03T11:55:00Z', MAINTENANT)).toBe('il y a 5 minutes');
    expect(dateRelativeAlerte('2026-10-20T12:00:00Z', MAINTENANT)).toBe('il y a 14 jours');
    expect(dateRelativeAlerte('2026-09-01T12:00:00Z', MAINTENANT)).toBe('1 sept. 2026');
    expect(dateRelativeAlerte('nope', MAINTENANT)).toBe('');
  });
});

describe('durées : jamais certaines', () => {
  it('arrondi à l’entier inférieur : minutes, heures, jours', () => {
    expect(formaterDureeApprox(0)).toBe('0 min');
    expect(formaterDureeApprox(35)).toBe('35 min');
    expect(formaterDureeApprox(59.9)).toBe('59 min');
    expect(formaterDureeApprox(60)).toBe('1 h');
    expect(formaterDureeApprox(47 * 60 + 59)).toBe('47 h');
    expect(formaterDureeApprox(48 * 60)).toBe('2 jours');
    expect(formaterDureeApprox(24 * 60 * 30 + 600)).toBe('30 jours');
    expect(formaterDureeApprox(-5)).toBe('0 min');
  });

  const duree = { duree_minutes: 3 * 24 * 60, duree_approximative: true, duree_minimale: false, duree_en_cours: false };

  it('terminé : « Durée : environ 3 jours »', () => expect(phraseDuree(duree)).toBe('Durée : environ 3 jours'));
  it('en cours : « En cours depuis environ 3 jours »', () => expect(phraseDuree({ ...duree, duree_en_cours: true })).toBe('En cours depuis environ 3 jours'));
  it('début tronqué : « au moins » (prime sur « environ »)', () => {
    expect(phraseDuree({ ...duree, duree_minimale: true })).toBe('Durée : au moins 3 jours');
    expect(valeurDuree({ ...duree, duree_minimale: true, duree_en_cours: true })).toBe('au moins 3 jours');
  });
  it('sans mention d’approximation seulement si le serveur dit explicitement « exacte »', () => {
    expect(phraseDuree({ ...duree, duree_approximative: false })).toBe('Durée : 3 jours');
    expect(phraseDuree({ ...duree, duree_approximative: undefined as never })).toBe('Durée : environ 3 jours');
  });

  it('délai de prise en charge EXACT (deux instants constatés)', () => {
    expect(formaterDelaiExact(0)).toBe('0 minute');
    expect(formaterDelaiExact(1)).toBe('1 minute');
    expect(formaterDelaiExact(35)).toBe('35 minutes');
    expect(formaterDelaiExact(135)).toBe('2 h 15 min');
    expect(formaterDelaiExact(120)).toBe('2 h');
    expect(formaterDelaiExact(25 * 60)).toBe('1 jour 1 h');
    expect(formaterDelaiExact(48 * 60)).toBe('2 jours');
  });
});

describe('commentaire de prise en charge', () => {
  it('même règle que le serveur : espaces de début et de fin retirés, vide = absent', () => {
    expect(nettoyerCommentaire('  Rappel prévu  ')).toBe('Rappel prévu');
    expect(nettoyerCommentaire('   ')).toBeUndefined();
    expect(nettoyerCommentaire('')).toBeUndefined();
  });

  it('limite de 500 caractères et compteur lisible', () => {
    expect(COMMENTAIRE_MAX).toBe(500);
    expect(compteurCommentaire('')).toBe('0 / 500 caractères');
    expect(compteurCommentaire('a'.repeat(120))).toBe('120 / 500 caractères');
    expect(caracteresRestants('a'.repeat(480))).toBe(20);
    expect(caracteresRestants('a'.repeat(500))).toBe(0);
  });
});

const erreurHttp = (status: number, detail?: unknown) =>
  new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { status, data: detail === undefined ? {} : { detail }, statusText: '', headers: {}, config: {} as never } as AxiosResponse);

describe('échec de la prise en charge', () => {
  it('409 « déjà prise en charge » : message clair en français', () => {
    expect(classerEchecPriseEnCharge(erreurHttp(409, 'Cette alerte est déjà prise en charge.'))).toEqual({ type: 'conflit', message: MESSAGE_DEJA_PRISE_EN_CHARGE });
  });

  it('409 « terminée » : message distinct', () => {
    expect(classerEchecPriseEnCharge(erreurHttp(409, 'Cette alerte est terminée : les données ne montrent plus de dépassement.'))).toEqual({ type: 'conflit', message: MESSAGE_ALERTE_TERMINEE });
  });

  it('409 sans texte exploitable : le message générique « déjà prise en charge »', () => {
    expect(classerEchecPriseEnCharge(erreurHttp(409))).toEqual({ type: 'conflit', message: MESSAGE_DEJA_PRISE_EN_CHARGE });
  });

  it('404 : l’alerte n’est plus disponible', () => {
    expect(classerEchecPriseEnCharge(erreurHttp(404, 'Alerte introuvable.'))).toEqual({ type: 'introuvable', message: MESSAGE_ALERTE_INTROUVABLE });
  });

  it('les autres erreurs : « Réessayer », jamais le texte brut du serveur', () => {
    for (const e of [erreurHttp(500, 'Traceback secret'), erreurHttp(503), new Error('boom'), new AxiosError('Network Error', 'ERR_NETWORK')]) {
      const r = classerEchecPriseEnCharge(e);
      expect(r.type).toBe('reessayer');
      expect(r.message).not.toContain('Traceback');
      expect(r.message).not.toContain('boom');
    }
  });

  it('envoyerPriseEnCharge : succès, commentaire nettoyé (absent s’il est vide)', async () => {
    const envoyer = vi.fn().mockResolvedValue({});
    expect(await envoyerPriseEnCharge(envoyer, 'ep1', '  bonjour  ')).toEqual({ type: 'succes' });
    expect(envoyer).toHaveBeenCalledWith('ep1', 'bonjour');
    await envoyerPriseEnCharge(envoyer, 'ep1', '   ');
    expect(envoyer).toHaveBeenLastCalledWith('ep1', undefined);
  });

  it('envoyerPriseEnCharge : ne lève jamais', async () => {
    const r = await envoyerPriseEnCharge(vi.fn().mockRejectedValue(erreurHttp(409, 'Cette alerte est déjà prise en charge.')), 'ep1', '');
    expect(r.type).toBe('conflit');
    expect((await envoyerPriseEnCharge(vi.fn().mockRejectedValue(new Error('x')), 'ep1', '')).type).toBe('reessayer');
  });
});

describe('filtres et paramètres de l’historique', () => {
  it('filtres initiaux : aucun paramètre sauf la taille de page', () => {
    expect(parametresHistorique(FILTRES_INITIAUX, null, MAINTENANT)).toEqual({ limite: 20 });
    expect(filtresActifs(FILTRES_INITIAUX)).toBe(false);
  });

  it('statut, agence, période (« du » = maintenant − N jours) et curseur', () => {
    const p = parametresHistorique({ statut: 'terminee', agenceId: 'a2', periode: '30j' }, 'CURSEUR', MAINTENANT);
    expect(p).toEqual({ limite: 20, statut: 'terminee', agence_id: 'a2', du: '2026-10-04T12:00:00.000Z', curseur: 'CURSEUR' });
    expect(parametresHistorique({ ...FILTRES_INITIAUX, periode: '7j' }, null, MAINTENANT).du).toBe('2026-10-27T12:00:00.000Z');
    expect(parametresHistorique({ ...FILTRES_INITIAUX, periode: '90j' }, null, MAINTENANT).du).toBe('2026-08-05T12:00:00.000Z');
    expect(filtresActifs({ ...FILTRES_INITIAUX, agenceId: 'a1' })).toBe(true);
  });
});

describe('état de la liste paginée', () => {
  const e = (id: string) => episode({ episode_id: id });

  it('première réponse : prête, avec curseur et disponibilité', () => {
    const s = historiqueReducer(historiqueInitial, { type: 'succes', episodes: [e('1')], curseur: 'c1', disponible: true });
    expect(s).toMatchObject({ statut: 'pret', charge: true, curseur: 'c1', disponible: true });
  });

  it('un nouveau chargement garde la liste affichée', () => {
    const pret = historiqueReducer(historiqueInitial, { type: 'succes', episodes: [e('1')], curseur: null, disponible: true });
    expect(historiqueReducer(pret, { type: 'debut' })).toMatchObject({ statut: 'chargement', episodes: [expect.anything()] });
  });

  it('« Voir plus » ajoute la page suivante sans doublon', () => {
    let s = historiqueReducer(historiqueInitial, { type: 'succes', episodes: [e('1'), e('2')], curseur: 'c1', disponible: true });
    s = historiqueReducer(s, { type: 'plus_debut' });
    expect(s.chargePlus).toBe(true);
    s = historiqueReducer(s, { type: 'plus_succes', episodes: [e('2'), e('3')], curseur: null });
    expect(s.episodes.map((x) => x.episode_id)).toEqual(['1', '2', '3']);
    expect(s).toMatchObject({ curseur: null, chargePlus: false });
  });

  it('échec de « Voir plus » : la liste reste, l’erreur est signalée ; l’échec initial n’invente pas une liste vide', () => {
    let s = historiqueReducer(historiqueInitial, { type: 'succes', episodes: [e('1')], curseur: 'c1', disponible: true });
    s = historiqueReducer(s, { type: 'plus_echec' });
    expect(s).toMatchObject({ erreurPlus: true, chargePlus: false, episodes: [expect.anything()] });
    const echec = historiqueReducer(historiqueInitial, { type: 'echec' });
    expect(echec).toMatchObject({ statut: 'erreur', charge: false });
  });

  it('interrupteur coupé : « disponible » faux, la section disparaîtra', () => {
    expect(historiqueReducer(historiqueInitial, { type: 'succes', episodes: [], curseur: null, disponible: false })).toMatchObject({ disponible: false, charge: true });
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Alerte, EpisodeDetail, EpisodeHistorique } from '../../types';
import PilotageAlertesActionsTab, { LigneSeuil } from '../../pages/cx/PilotageAlertesActionsTab';
import type { AlertesData, RecosData } from '../../pages/cx/AlertesView';
import type { EtatSource } from '../../pages/cx/alertesVue';
import { phraseSynthese, syntheseAlertes } from '../../pages/cx/alertesVue';
import { CorpsPriseEnCharge, PiedPriseEnCharge } from './PriseEnChargeDialog';
import SuiviEpisode, { PastilleEtatEpisode } from './EtatEpisode';
import { ContenuDetailEpisode, LigneHistorique, VueHistorique, type VueHistoriqueProps } from './HistoriqueAlertes';
import { ESPACE_INSECABLE } from '../../utils/formatNombre';
import { episodeDeAlerte, historiqueInitial, type EtatHistorique, FILTRES_INITIAUX } from '../../utils/episodesAlertes';

const dansRouteur = (el: React.ReactElement) => renderToStaticMarkup(<StaticRouter location="/alertes">{el}</StaticRouter>);

const MAINTENANT = new Date('2026-11-03T12:00:00Z');
const alerte = (s: Partial<Alerte> = {}): Alerte => ({
  agence_id: 'a1', agence_nom: 'Agence A1', taux_actuel: 50, seuil: 70, message: 'm', gravite: 'critique', ecart_seuil: 20, ...s,
});
const detectee = (s: Partial<Alerte> = {}): Alerte => alerte({
  episode_id: 'ep1', episode_statut: 'detectee', detecte_le: '2026-10-20T08:00:00Z', debut_condition: '2026-10-12T10:00:00Z', debut_approximatif: true,
  debut_remontee_limitee: false, ...s,
});
const priseEnCharge = (s: Partial<Alerte> = {}): Alerte => detectee({
  episode_statut: 'prise_en_charge', pris_en_charge_le: '2026-10-21T08:00:00Z', pris_en_charge_par_nom: 'Awa Traoré', commentaire_prise_en_charge: 'Rappel de l’équipe prévu demain', ...s,
});

const episode = (s: Partial<EpisodeHistorique> = {}): EpisodeHistorique => ({
  episode_id: 'e1', agence_id: 'a1', agence_nom: 'Agence A1', type: 'seuil_satisfaction', statut: 'terminee', gravite_ouverture: 'critique',
  detecte_le: '2026-10-12T10:05:00Z', debut_condition: '2026-10-12T10:00:00Z', debut_approximatif: true, debut_remontee_limitee: false,
  fin_condition: '2026-10-15T09:00:00Z', terminee_le: '2026-10-15T09:05:00Z', fin_cause: 'retablie', duree_minutes: 3 * 24 * 60, duree_approximative: true,
  duree_minimale: false, duree_en_cours: false, taux_ouverture: 50, seuil_ouverture: 70, taux_fermeture: 80, seuil_fermeture: 70, ...s,
});
const detail = (s: Partial<EpisodeDetail> = {}): EpisodeDetail => ({ ...episode(), created_at: '2026-10-12T10:05:00Z', commentaire_prise_en_charge: null, delai_prise_en_charge_minutes: null, ...s });

// ── La liste active : l'état, le suivi, le bouton ─────────────────────────────────────────────────

const etatAlertes = (donnees: Partial<AlertesData> = {}): EtatSource<AlertesData> => ({ statut: 'pret', charge: true, donnees: { seuil: [], avis: [], incluses: true, ...donnees } });
const etatRecos: EtatSource<RecosData> = { statut: 'pret', charge: true, donnees: { items: [], total: 0 } };
const page = (surcharge: Partial<React.ComponentProps<typeof PilotageAlertesActionsTab>> = {}) =>
  dansRouteur(
    <PilotageAlertesActionsTab
      isAgencyManager alertes={etatAlertes()} recos={etatRecos} recosLoadingMore={false} nomForfait={null} agences={[]} selectedAgenceId={null}
      onSelectAgence={vi.fn()} onRefresh={vi.fn()} onRetryRecos={vi.fn()} onLoadMoreRecos={vi.fn()} onMarquerRecoTraitee={vi.fn()} {...surcharge}
    />,
  );

describe('alerte de seuil : état visible et sobre', () => {
  it('Détectée : UNE pastille d’état (texte + icône), distincte du badge de niveau', () => {
    const html = dansRouteur(<LigneSeuil alerte={detectee()} isAgencyManager cible={false} />);
    expect(html.match(/alerte-etat/g)).toHaveLength(1);
    expect(html).toContain('Détectée');
    expect(html).toContain('Critique');                     // le niveau reste, une seule fois
    expect(html.match(/Critique/g)).toHaveLength(1);
    expect(html).not.toContain('Prise en charge<');         // pas d’état contradictoire
    expect(html.match(/<svg/g)!.length).toBeGreaterThanOrEqual(3);   // jamais la couleur seule : l’état a son icône
  });

  it('Prise en charge : la pastille, la date, l’auteur et le commentaire', () => {
    const html = dansRouteur(<LigneSeuil alerte={priseEnCharge()} isAgencyManager={false} cible={false} />);
    expect(html).toContain('alerte-etat');
    expect(html).toContain('Prise en charge');
    expect(html).toContain('Awa Traoré');
    expect(html).toContain('Rappel de l’équipe prévu demain');
    expect(html).toContain('<time');
    expect(html).toContain('title="21 octobre 2026');       // date complète au survol
  });

  it('sans épisode (ancien serveur, interrupteur coupé) : l’alerte s’affiche exactement comme avant', () => {
    const html = dansRouteur(<LigneSeuil alerte={alerte()} isAgencyManager cible={false} />);
    expect(html).not.toContain('alerte-etat');
    expect(html).not.toContain('Depuis');
    expect(html).not.toContain('Prendre en charge');
    expect(html).toContain('Satisfaction sous le seuil');
  });
});

describe('début : toujours « environ » ou « au moins », jamais certain', () => {
  it('« Depuis environ le 12 oct. » avec la date complète au survol', () => {
    const html = renderToStaticMarkup(<SuiviEpisode episode={episodeDeAlerte(detectee())!} maintenant={MAINTENANT} />);
    expect(html).toContain('Depuis environ le');
    expect(html).toContain('>12 oct.</time>');
    expect(html).toContain('title="12 octobre 2026 à ');
    expect(html).not.toContain('Depuis le ');
  });

  it('début tronqué : « Depuis au moins le … »', () => {
    const html = renderToStaticMarkup(<SuiviEpisode episode={episodeDeAlerte(detectee({ debut_remontee_limitee: true }))!} maintenant={MAINTENANT} />);
    expect(html).toContain('Depuis au moins le');
    expect(html).not.toContain('Depuis environ');
  });

  it('la mention d’approximation est TOUJOURS là : serveur muet ou début « null » comprise', () => {
    for (const a of [detectee({ debut_approximatif: null }), detectee({ debut_approximatif: undefined }), detectee({ debut_approximatif: true })]) {
      expect(renderToStaticMarkup(<SuiviEpisode episode={episodeDeAlerte(a)!} maintenant={MAINTENANT} />)).toContain('Depuis environ le');
    }
  });

  it('la page entière dit « environ » pour l’Agency Manager comme pour le CX Manager', () => {
    for (const isAgencyManager of [true, false]) {
      expect(page({ isAgencyManager, alertes: etatAlertes({ seuil: [detectee()] }) })).toContain('Depuis environ le');
    }
  });
});

describe('bouton « Prendre en charge » : Agency Manager seul', () => {
  const surcharge = (isAgencyManager: boolean, a: Alerte, avecAction = true) => ({ isAgencyManager, alertes: etatAlertes({ seuil: [a] }), ...(avecAction ? { onPrendreEnCharge: vi.fn() } : {}) });

  it('présent pour l’Agency Manager sur une alerte détectée', () => {
    const html = page(surcharge(true, detectee()));
    expect(html).toContain('Prendre en charge');
    expect(html).toContain('aria-label="Prendre en charge l’alerte de Agence A1"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('ABSENT pour le CX Manager, même si l’action est fournie', () => {
    const html = page(surcharge(false, detectee()));
    expect(html).not.toContain('Prendre en charge');
    expect(html).toContain('Détectée');                    // il voit l’état, en lecture seule
  });

  it('absent d’une alerte déjà prise en charge, sans épisode, et quand aucune action n’est fournie', () => {
    expect(page(surcharge(true, priseEnCharge()))).not.toContain('aria-haspopup="dialog"');
    expect(page(surcharge(true, alerte()))).not.toContain('Prendre en charge');
    expect(page(surcharge(true, detectee(), false))).not.toContain('Prendre en charge');
  });

  it('le lien existant de la ligne reste (Analyser la tendance / Voir l’agence)', () => {
    expect(page(surcharge(true, detectee()))).toContain('Analyser la tendance');
    expect(page(surcharge(false, detectee()))).toContain('Voir l’agence');
  });
});

describe('rien de ce qui existait ne régresse', () => {
  it('la synthèse et les compteurs ne dépendent pas de l’état de l’épisode', () => {
    const sans = [alerte({ agence_id: 'a1' }), alerte({ agence_id: 'a2' })];
    const avec = [detectee({ agence_id: 'a1' }), priseEnCharge({ agence_id: 'a2' })];
    const phrase = (seuil: Alerte[]) => phraseSynthese(syntheseAlertes({ seuil, avis: [], agenceId: null, cx: true })!);
    expect(phrase(avec)).toBe(phrase(sans));
    const compteurs = (seuil: Alerte[]) => page({ alertes: etatAlertes({ seuil }) }).match(/Toutes \(\d+\)|Satisfaction \(\d+\)|Avis clients \(\d+\)/g);
    expect(compteurs(avec)).toEqual(compteurs(sans));
    expect(page({ alertes: etatAlertes({ seuil: avec }) })).toContain('Satisfaction sous le seuil (2)');
  });

  it('une alerte prise en charge RESTE dans la liste', () => {
    const html = page({ alertes: etatAlertes({ seuil: [priseEnCharge()] }) });
    expect(html).toContain('Agence A1');
    expect(html).toContain('Satisfaction sous le seuil (1)');
  });

  it('sans historique fourni, la page est celle d’avant ; avec, il est placé sous la liste active', () => {
    expect(page()).not.toContain('Historique des alertes');
    const html = page({ historique: <section id="histo">Historique des alertes</section> });
    expect(html.indexOf('Alertes actives')).toBeLessThan(html.indexOf('Historique des alertes'));
  });
});

// ── La boîte de dialogue ──────────────────────────────────────────────────────────────────────────

const corps = (s: Partial<React.ComponentProps<typeof CorpsPriseEnCharge>> = {}) =>
  renderToStaticMarkup(<CorpsPriseEnCharge agenceNom="Agence A1" commentaire="" onCommentaire={vi.fn()} envoi={false} erreur={null} onReessayer={vi.fn()} idChamp="champ" idCompteur="compteur" {...s} />);

describe('boîte de dialogue de prise en charge', () => {
  it('champ facultatif, libellé associé, focus initial sur le champ, limite et compteur de 500 caractères', () => {
    const html = corps();
    expect(html).toContain('for="champ"');
    expect(html).toContain('id="champ"');
    expect(html).toContain('(facultatif)');
    expect(html).toContain('data-autofocus');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('aria-describedby="compteur"');
    expect(html).toContain('0 / 500 caractères');
  });

  it('le compteur suit la saisie et alerte à l’approche de la limite (texte, pas seulement la couleur)', () => {
    expect(corps({ commentaire: 'a'.repeat(120) })).toContain('120 / 500 caractères');
    const proche = corps({ commentaire: 'a'.repeat(480) });
    expect(proche).toContain('is-limite');
    expect(proche).toContain('Il reste 20 caractères.');
    expect(corps({ commentaire: 'a'.repeat(500) })).toContain('Limite de caractères atteinte.');
    expect(corps({ commentaire: 'a'.repeat(120) })).not.toContain('Il reste');
  });

  it('explique ce que fait la prise en charge, sans promettre que l’alerte disparaît', () => {
    const html = corps();
    expect(html).toContain('Agence A1');
    expect(html).toContain('reste affichée');
  });

  it('pendant l’envoi : champ en lecture seule', () => expect(corps({ envoi: true })).toContain('readonly'));

  it('erreur : région annoncée (role="alert") avec « Réessayer »', () => {
    const html = corps({ erreur: 'La prise en charge n’a pas pu être enregistrée. Réessayez.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('La prise en charge n’a pas pu être enregistrée');
    expect(html).toContain('Réessayer');
    expect(corps()).not.toContain('role="alert"');
  });

  it('confirmation explicite ; pendant l’envoi : tout est désactivé, indicateur de chargement', () => {
    const repos = renderToStaticMarkup(<PiedPriseEnCharge envoi={false} onAnnuler={vi.fn()} onConfirmer={vi.fn()} />);
    expect(repos).toContain('Confirmer la prise en charge');
    expect(repos).toContain('Annuler');
    expect(repos).not.toContain('disabled');
    const envoi = renderToStaticMarkup(<PiedPriseEnCharge envoi onAnnuler={vi.fn()} onConfirmer={vi.fn()} />);
    expect(envoi).toContain('Enregistrement…');
    expect(envoi).toContain('ui-spinner');
    expect(envoi).toContain('aria-busy="true"');
    expect(envoi.match(/disabled/g)).toHaveLength(2);       // Annuler ET Confirmer
  });
});

// ── L'historique ──────────────────────────────────────────────────────────────────────────────────

const pret = (s: Partial<EtatHistorique> = {}): EtatHistorique => ({ ...historiqueInitial, statut: 'pret', charge: true, ...s });
const vue = (etat: EtatHistorique, s: Partial<VueHistoriqueProps> = {}) =>
  renderToStaticMarkup(
    <VueHistorique etat={etat} filtres={FILTRES_INITIAUX} ouvert agencePropre={false} agences={[{ id: 'a1', nom: 'Agence A1' }, { id: 'a2', nom: 'Agence A2' }]}
      onBascule={vi.fn()} onFiltres={vi.fn()} onReessayer={vi.fn()} onVoirPlus={vi.fn()} onDetail={vi.fn()} maintenant={MAINTENANT} {...s} />,
  );

describe('historique des alertes', () => {
  it('repliée par défaut : un titre dans un bouton (aria-expanded), ni filtres ni liste', () => {
    const html = vue(pret({ episodes: [episode()] }), { ouvert: false });
    expect(html).toContain('Historique des alertes');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls');
    expect(html).not.toContain('Voir le détail');
    expect(html).not.toContain('Filtres de l’historique');
  });

  it('dépliée : filtres état / période, et agence pour le CX Manager seulement', () => {
    const cx = vue(pret({ episodes: [episode()] }));
    expect(cx).toContain('aria-expanded="true"');
    expect(cx).toContain('Détectées');
    expect(cx).toContain('Prises en charge');
    expect(cx).toContain('Terminées');
    expect(cx).toContain('30 derniers jours');
    expect(cx).toContain('Filtrer l’historique par agence');
    expect(vue(pret({ episodes: [episode()] }), { agencePropre: true })).not.toContain('Filtrer l’historique par agence');
  });

  it('lignes : état, période « environ », durée approximative, cause de fin en français, accès au détail', () => {
    const html = vue(pret({ episodes: [episode()] }));
    expect(html).toContain('Terminée');
    expect(html).toContain('Situation rétablie');
    expect(html).toContain('Environ du');
    expect(html).toContain('Durée : environ 3 jours');
    expect(html).toContain('Voir le détail');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Agence A1');
  });

  it('chaque cause de fin porte son libellé français, jamais la clé technique', () => {
    for (const [cause, libelle] of [['retablie', 'Situation rétablie'], ['donnees_insuffisantes', 'Données insuffisantes'], ['seuil_modifie', 'Seuil modifié'], ['agence_desactivee', 'Agence désactivée']] as const) {
      const html = renderToStaticMarkup(<ul><LigneHistorique episode={episode({ fin_cause: cause })} agencePropre={false} onDetail={vi.fn()} maintenant={MAINTENANT} /></ul>);
      expect(html).toContain(libelle);
      expect(html).not.toContain(cause);
    }
  });

  it('début tronqué : « au moins », jamais « environ » seul ; épisode ouvert : durée « en cours depuis environ »', () => {
    const tronque = renderToStaticMarkup(<ul><LigneHistorique episode={episode({ debut_remontee_limitee: true, duree_minimale: true })} agencePropre onDetail={vi.fn()} maintenant={MAINTENANT} /></ul>);
    expect(tronque).toContain('Depuis au moins le');
    expect(tronque).toContain('Durée : au moins 3 jours');
    const ouvert = renderToStaticMarkup(<ul><LigneHistorique episode={episode({ statut: 'detectee', fin_condition: null, terminee_le: null, fin_cause: null, duree_en_cours: true })} agencePropre onDetail={vi.fn()} maintenant={MAINTENANT} /></ul>);
    expect(ouvert).toContain('En cours depuis environ 3 jours');
    expect(ouvert).toContain('Depuis environ le');
  });

  it('Agency Manager : pas de nom d’agence répété dans chaque ligne', () => {
    expect(renderToStaticMarkup(<ul><LigneHistorique episode={episode()} agencePropre onDetail={vi.fn()} maintenant={MAINTENANT} /></ul>)).not.toContain('alerte-ligne__agence');
  });

  it('« Voir plus » seulement s’il y a un curseur ; ajout au fil de l’eau, compteur annoncé', () => {
    const suite = vue(pret({ episodes: [episode()], curseur: 'c1' }));
    expect(suite).toContain('Voir plus');
    expect(suite).toContain('1 alerte affichée, d’autres sont disponibles');
    const fin = vue(pret({ episodes: [episode(), episode({ episode_id: 'e2' })], curseur: null }));
    expect(fin).not.toContain('Voir plus');
    expect(fin).toContain('2 alertes affichées.');
    expect(vue(pret({ episodes: [episode()], curseur: 'c1', chargePlus: true }))).toContain('aria-busy="true"');
  });

  it('erreur de « Voir plus » : message et « Réessayer », la liste reste', () => {
    const html = vue(pret({ episodes: [episode()], curseur: 'c1', erreurPlus: true }));
    expect(html).toContain('La suite de l’historique n’a pas pu être chargée.');
    expect(html).toContain('Agence A1');
  });

  it('chargement initial : emplacement réservé (pas de saut de page), indicateur accessible', () => {
    const html = vue(historiqueInitial);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement de l’historique des alertes');
    expect(html).not.toContain('aria-expanded');
  });

  it('chargement d’un filtre : squelettes dans la section ouverte', () => {
    const html = vue(pret({ statut: 'chargement' }));
    expect(html).toContain('Chargement de l’historique');
    expect(html).toContain('ui-skeleton');
  });

  it('erreur : message et « Réessayer », JAMAIS « vide »', () => {
    const html = vue({ ...historiqueInitial, statut: 'erreur' });
    expect(html).toContain('Impossible de charger l’historique');
    expect(html).toContain('Cela ne signifie pas qu’il est vide');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Pas encore d’historique');
  });

  it('actualisation échouée avec des données : la liste reste et l’avertissement le dit', () => {
    const html = vue(pret({ statut: 'erreur', episodes: [episode()] }));
    expect(html).toContain('peut ne plus être à jour');
    expect(html).toContain('Agence A1');
  });

  it('vide : une phrase utile, adaptée au rôle', () => {
    expect(vue(pret())).toContain('Pas encore d’historique');
    expect(vue(pret())).toContain('une agence du réseau');
    expect(vue(pret(), { agencePropre: true })).toContain('votre agence');
  });

  it('vide à cause des filtres : on le dit et on propose de les réinitialiser', () => {
    const html = vue(pret(), { filtres: { statut: 'terminee', agenceId: null, periode: '7j' } });
    expect(html).toContain('Aucune alerte pour ces filtres');
    expect(html).toContain('Réinitialiser les filtres');
    expect(html).not.toContain('Pas encore d’historique');
  });

  it('interrupteur coupé ou forfait sans alertes : la section disparaît, rien d’autre', () => {
    expect(vue(pret({ disponible: false }))).toBe('');
    expect(vue(pret({ disponible: false }), { ouvert: false })).toBe('');
  });
});

describe('tiroir de détail', () => {
  it('toutes les dates, la cause de fin expliquée, la durée approximative, les taux et seuils', () => {
    const html = renderToStaticMarkup(<ContenuDetailEpisode episode={detail()} agencePropre={false} />);
    expect(html).toContain('Début de la situation');
    expect(html).toContain('Depuis environ le');
    expect(html).toContain('date approximative');
    expect(html).toContain('Détectée par IKAN');
    expect(html).toContain('Fin de la situation');
    expect(html).toContain('Fin constatée par IKAN');
    expect(html).toContain('Cause de la fin');
    expect(html).toContain('Situation rétablie');
    expect(html).toContain('repassée au-dessus du seuil');
    expect(html).toContain('environ 3 jours');
    expect(html).toContain(`50${ESPACE_INSECABLE}% de satisfaction, pour un seuil de 70${ESPACE_INSECABLE}%`);
    expect(html).toContain(`80${ESPACE_INSECABLE}% de satisfaction, pour un seuil de 70${ESPACE_INSECABLE}%`);
    expect(html).toContain('Agence A1');
    expect(html).toContain('<time');
  });

  it('prise en charge : auteur, date, commentaire et délai exact', () => {
    const html = renderToStaticMarkup(<ContenuDetailEpisode agencePropre episode={detail({ pris_en_charge_le: '2026-10-12T11:00:00Z', pris_en_charge_par_nom: 'Awa Traoré', commentaire_prise_en_charge: 'Équipe prévenue', delai_prise_en_charge_minutes: 55 })} />);
    expect(html).toContain('Awa Traoré');
    expect(html).toContain('« Équipe prévenue »');
    expect(html).toContain('Délai après la détection : 55 minutes.');
    expect(html).not.toContain('Aucune prise en charge');
  });

  it('jamais prise en charge : on le dit (terminée) ou « pas encore » (en cours)', () => {
    expect(renderToStaticMarkup(<ContenuDetailEpisode agencePropre episode={detail()} />)).toContain('Aucune prise en charge avant la fin de l’alerte.');
    const ouvert = detail({ statut: 'detectee', fin_condition: null, terminee_le: null, fin_cause: null, taux_fermeture: null, duree_en_cours: true });
    const html = renderToStaticMarkup(<ContenuDetailEpisode agencePropre episode={ouvert} />);
    expect(html).toContain('Pas encore prise en charge.');
    expect(html).toContain('(en cours)');
    expect(html).not.toContain('Cause de la fin');
    expect(html).not.toContain('Fin de la situation');
  });

  it('début tronqué : « au moins » et la précision que l’alerte est peut-être plus ancienne', () => {
    const html = renderToStaticMarkup(<ContenuDetailEpisode agencePropre episode={detail({ debut_remontee_limitee: true, duree_minimale: true })} />);
    expect(html).toContain('Depuis au moins le');
    expect(html).toContain('peut-être plus ancienne');
    expect(html).toContain('au moins 3 jours');
  });

  it('l’état de l’épisode est montré par une pastille, pas par la couleur seule', () => {
    const html = renderToStaticMarkup(<PastilleEtatEpisode statut="terminee" />);
    expect(html).toContain('Terminée');
    expect(html).toContain('<svg');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Alerte, AlerteFeedback } from '../../types';
import PilotageAlertesActionsTab from './PilotageAlertesActionsTab';
import type { AlertesData, RecosData } from './AlertesView';
import type { EtatSource } from './alertesVue';
import { AVIS_VISIBLES } from './alertesVue';

const seuil = (id = 'a1'): Alerte => ({ agence_id: id, agence_nom: `Agence ${id}`, taux_actuel: 50, seuil: 70, message: 'sous le seuil' });
const avis = (i: number, note = 1, agence = 'a1'): AlerteFeedback => ({
  feedback_id: `f${i}`, agence_id: agence, agence_nom: `Agence ${agence}`, note, categorie_nom: 'Accueil', raison: 'note_basse',
  commentaire: `commentaire ${i}`, date_soumission: new Date(Date.now() - i * 3600_000).toISOString(),
});

const etatAlertes = (donnees: Partial<AlertesData> = {}, extra: Partial<EtatSource<AlertesData>> = {}): EtatSource<AlertesData> => ({
  statut: 'pret', charge: true, donnees: { seuil: [], avis: [], incluses: true, ...donnees }, ...extra,
});
const etatRecos = (extra: Partial<EtatSource<RecosData>> = {}): EtatSource<RecosData> => ({ statut: 'pret', charge: true, donnees: { items: [], total: 0 }, ...extra });

const rendu = (surcharge: Partial<React.ComponentProps<typeof PilotageAlertesActionsTab>> = {}, location = '/alertes') =>
  renderToStaticMarkup(
    <StaticRouter location={location}>
      <PilotageAlertesActionsTab
        isAgencyManager
        alertes={etatAlertes()}
        recos={etatRecos()}
        recosLoadingMore={false}
        nomForfait={null}
        agences={[]}
        selectedAgenceId={null}
        onSelectAgence={vi.fn()}
        onRefresh={vi.fn()}
        onRetryRecos={vi.fn()}
        onLoadMoreRecos={vi.fn()}
        onMarquerRecoTraitee={vi.fn()}
        {...surcharge}
      />
    </StaticRouter>,
  );

describe('page /alertes — les six états', () => {
  it('chargement : indicateur accessible, ni liste ni message vide', () => {
    const html = rendu({ alertes: { statut: 'chargement', charge: false, donnees: { seuil: [], avis: [], incluses: true } } });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement des alertes');
    expect(html).not.toContain('Aucune alerte active');
  });

  it('aucune alerte : véritable état vide, sans promettre que tout va bien pour un autre périmètre', () => {
    const html = rendu();
    expect(html).toContain('Aucune alerte active');
    expect(html).not.toContain('Impossible de charger');
  });

  it('erreur de chargement initial : message et réessai, JAMAIS « Aucune alerte active »', () => {
    const html = rendu({ alertes: { statut: 'erreur', charge: false, donnees: { seuil: [], avis: [], incluses: true } } });
    expect(html).toContain('Impossible de charger les alertes');
    expect(html).toContain('Cela ne signifie pas qu’il n’y en a pas');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Aucune alerte active');
  });

  it('forfait sans alertes : message de forfait, pas d’état vide ni de panne', () => {
    const html = rendu({ alertes: etatAlertes({ incluses: false }), nomForfait: 'Gratuit', isAgencyManager: false });
    expect(html).toContain('ne sont pas incluses dans le forfait Gratuit');
    expect(html).toContain('pas parce que la satisfaction du réseau est bonne');
    expect(html).not.toContain('Aucune alerte active');
    expect(html).not.toContain('Impossible de charger');
  });

  it('forfait sans alertes côté Responsable d’agence : message générique', () => {
    const html = rendu({ alertes: etatAlertes({ incluses: false }) });
    expect(html).toContain('forfait de votre organisation');
    expect(html).not.toContain('Aucune alerte active');
  });

  it('échec d’actualisation avec données : les alertes restent affichées avec un avertissement', () => {
    const html = rendu({ alertes: etatAlertes({ avis: [avis(1)] }, { statut: 'erreur' }) });
    expect(html).toContain('commentaire 1');
    expect(html).toContain('n’ont pas pu être actualisées');
    expect(html).not.toContain('Aucune alerte active');
  });

  it('données disponibles : deux types distincts avec leurs libellés écrits', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()], avis: [avis(1)] }) });
    expect(html).toContain('Satisfaction sous le seuil');
    expect(html).toContain('alerte-ligne__raison">Note basse<');
    expect(html).toContain('Catégorie « Accueil » · Note 1/5');
    expect(html).toContain('pour un seuil de 70 %');
  });
});

describe('page /alertes — hiérarchie, volume et filtres', () => {
  it('au plus cinq avis visibles, le total et le dépliage sont annoncés', () => {
    const beaucoup = Array.from({ length: 25 }, (_, i) => avis(i, 3));
    const html = rendu({ alertes: etatAlertes({ avis: beaucoup }) });
    expect((html.match(/id="alerte-feedback-/g) || []).length).toBe(AVIS_VISIBLES);
    expect(html).toContain(`${AVIS_VISIBLES} avis affichés sur 25`);
    expect(html).toContain('Voir les 20 avis');
    expect(html).toContain('aria-expanded="false"');
  });

  it('une alerte ciblée par la cloche hors de la limite est présente dans la page', () => {
    const beaucoup = Array.from({ length: 25 }, (_, i) => avis(i, 3));
    const html = rendu({ alertes: etatAlertes({ avis: beaucoup }) }, '/alertes#alerte-feedback-f24');
    expect(html).toContain('id="alerte-feedback-f24"');
    expect(html).toContain('25 avis affichés sur 25');
  });

  it('les avis critiques passent avant les autres et la gravité est écrite', () => {
    const html = rendu({ alertes: etatAlertes({ avis: [avis(1, 4), avis(2, 1)] }) });
    expect(html.indexOf('alerte-feedback-f2')).toBeLessThan(html.indexOf('alerte-feedback-f1'));
    expect(html).toContain('ui-badge--critical');
    expect(html).toContain('ui-badge--warning');
    expect(html).toContain('>Critique<');
    expect(html).toContain('>À surveiller<');
  });

  it('les ancres de la cloche sont conservées pour les deux types', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil('a9')], avis: [avis(5)] }) });
    expect(html).toContain('id="alerte-seuil-a9"');
    expect(html).toContain('id="alerte-feedback-f5"');
  });

  it('les types affichent leurs compteurs', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()], avis: [avis(1), avis(2)] }) });
    expect(html).toContain('Toutes (3)');
    expect(html).toContain('Satisfaction (1)');
    expect(html).toContain('Avis clients (2)');
  });

  it('sélecteur d’agence réservé au CX Manager, avec un nom accessible', () => {
    expect(rendu({ isAgencyManager: true })).not.toContain('<select');
    const cx = rendu({ isAgencyManager: false, agences: [{ id: 'a1', nom: 'Agence a1' } as never] });
    expect(cx).toContain('<select');
    expect(cx).toContain('aria-label="Filtrer les alertes et recommandations par agence"');
  });

  it('filtre d’agence sans résultat alors que des alertes existent : message distinct avec le total', () => {
    const html = rendu({ isAgencyManager: false, selectedAgenceId: 'autre', alertes: etatAlertes({ avis: [avis(1)] }) });
    expect(html).toContain('Aucune alerte pour ces filtres');
    expect(html).toContain('1 alerte au total');
    expect(html).toContain('Réinitialiser les filtres');
  });
});

describe('page /alertes — liens vers les avis et les agences', () => {
  it('Responsable d’agence : « Traiter l’avis » → sa liste d’avis critiques', () => {
    const html = rendu({ alertes: etatAlertes({ avis: [avis(1, 1, 'a1')] }) });
    expect(html).toContain('href="/feedbacks?tab=critiques&amp;avis=f1"');
    expect(html).toContain('Traiter l’avis');
  });

  it('CX Manager : « Traiter l’avis » → l’aperçu de L’AGENCE de l’alerte, onglet Avis', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ avis: [avis(1, 1, 'agence-7')] }) });
    expect(html).toContain('href="/agences/agence-7/apercu?tab=feedbacks&amp;avis=f1"');
    expect(html).not.toContain('href="/feedbacks');
  });

  it('alerte de seuil : le CX ouvre l’agence, le Responsable analyse la tendance', () => {
    expect(rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('agence-9')] }) })).toContain('href="/agences/agence-9/apercu"');
    expect(rendu({ alertes: etatAlertes({ seuil: [seuil('agence-9')] }) })).toContain('href="/statistiques"');
  });

  it('une alerte n’est jamais déclarée résolue par l’interface : aucun bouton « résoudre » ni « acquitter »', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()], avis: [avis(1)] }) });
    expect(html).not.toMatch(/Résoudre|Acquitter|Marquer l’alerte|Clôturer/);
    expect(html).toContain('disparaît quand l’avis est marqué comme résolu');
  });
});

describe('page /alertes — niveau écrit, aide repliée, aucun résultat, sous-titre', () => {
  const avisSentiment = (i: number, note: number): AlerteFeedback => ({ ...avis(i, note), raison: 'sentiment_negatif' });
  const occurrences = (html: string, motif: string) => html.split(motif).length - 1;

  it('niveau de chaque avis écrit : note ≤ 2 « Critique », sinon « À surveiller » (texte + icône, pas la couleur seule)', () => {
    const html = rendu({ alertes: etatAlertes({ avis: [avis(1, 2), avisSentiment(2, 3)] }) });
    expect(html).toContain('ui-badge--critical"><span class="ui-badge__icon" aria-hidden="true">');
    expect(html).toMatch(/ui-badge--critical"><span[^>]*>.*?<\/span>Critique</);
    expect(html).toMatch(/ui-badge--warning"><span[^>]*>.*?<\/span>À surveiller</);
    expect(occurrences(html, '>Critique<')).toBe(1);
    expect(occurrences(html, '>À surveiller<')).toBe(1);
  });

  it('la phrase « disparaît… » et la phrase de seuil sont écrites UNE fois par groupe, pas par ligne', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('a1'), seuil('a2'), seuil('a3')], avis: [avis(1), avis(2), avis(3)] }) });
    expect(occurrences(html, 'disparaît quand l’avis est marqué comme résolu')).toBe(1);
    expect(occurrences(html, 'Chaque alerte est affichée après 48 h sous le seuil')).toBe(1);
    expect(rendu({ alertes: etatAlertes({ seuil: [seuil('a1'), seuil('a2')] }) })).toContain('Chaque alerte disparaît quand la satisfaction des 7 derniers jours repasse au-dessus du seuil.');
  });

  it('plus d’encadré d’aide dans la page : l’aide est un lien près du titre (AideAlertes)', () => {
    const html = rendu({ alertes: etatAlertes({ avis: [avis(1)] }) });
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Comment lire cette page');
    expect(html).not.toContain('ui-alert--info');
  });

  it('aucun résultat : icône neutre de filtre (pas la coche verte) et message qui dit que le filtre masque les alertes', () => {
    const html = rendu({ isAgencyManager: false, selectedAgenceId: 'autre', alertes: etatAlertes({ avis: [avis(1)] }) });
    const alertes = html.split('Recommandations automatiques')[0];
    expect(alertes).toContain('alerte-vide-filtre');
    expect(alertes).not.toContain('var(--color-success)');
    expect(html).toContain('Ces filtres masquent les alertes');
  });

  it('aucune alerte active : la coche positive est conservée', () => {
    const alertes = rendu().split('Recommandations automatiques')[0];
    expect(alertes).not.toContain('alerte-vide-filtre');
    expect(alertes).toContain('var(--color-success)');
  });

  it('plus de sous-titre sous « Alertes actives » : les volumes ne sont pas répétés dans la carte', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()], avis: [avis(1, 1), avis(2, 2)] }) });
    const carte = html.split('Recommandations automatiques')[0];
    expect(carte).toContain('Alertes actives');
    expect(carte).not.toContain('ui-card__subtitle');
    expect(carte).not.toContain('tous critiques');
    expect(carte).not.toContain('note ≤ 2)');
  });
});

describe('page /alertes — recommandations (suggestions, pas des alertes)', () => {
  it('liste vide, erreur et résultats sont distincts', () => {
    expect(rendu()).toContain('Aucune recommandation en attente');
    const erreur = rendu({ recos: etatRecos({ statut: 'erreur', charge: false }) });
    expect(erreur).toContain('Impossible de charger les recommandations');
    expect(erreur).not.toContain('Aucune recommandation en attente');
  });

  it('précise qu’une recommandation n’est pas une action exécutée', () => {
    expect(rendu()).toContain('n’est pas une action exécutée');
  });
});

describe('page /alertes — synthèse, repli des avis par groupe de 5', () => {
  it('synthèse : bande compacte, chiffres en <b>, deux lignes de texte (titre + détail), pas de carte KPI', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('a1')], avis: [avis(1)] }) });
    expect(html).toContain('<span class="alerte-synthese__titre"><b class="alerte-synthese__n">2</b> situations à surveiller :</span>');
    expect(html).toContain('<span class="alerte-synthese__detail"><b class="alerte-synthese__n">1</b> alerte de seuil, <b class="alerte-synthese__n">1</b> avis à risque</span>');
    expect(html).not.toContain('ui-kpi');
  });

  const lignes = (html: string) => (html.match(/id="alerte-feedback-/g) || []).length;
  const synthese = (html: string) => (html.match(/<p class="alerte-synthese">.*?<\/p>/) || [''])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('synthèse du CX Manager : situations, détail, agences concernées, avis le plus ancien', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('a1'), seuil('a2')], avis: [avis(1, 1, 'a1'), avis(5, 2, 'a3')] }) });
    expect(synthese(html)).toBe('4 situations à surveiller : 2 alertes de seuil, 2 avis à risque 3 agences concernées Avis le plus ancien : il y a 5 heures');
  });

  it('Responsable d’agence : pas d’« agences concernées »', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil('a1')], avis: [avis(1)] }) });
    expect(synthese(html)).toContain('2 situations à surveiller : 1 alerte de seuil, 1 avis à risque');
    expect(html).not.toContain('agence concernée');
    expect(html).not.toContain('agences concernées');
  });

  it('absente en chargement, en erreur, sans forfait et sans alerte (jamais de « 0 situation »)', () => {
    expect(rendu()).not.toContain('alerte-synthese');
    expect(rendu({ alertes: { statut: 'chargement', charge: false, donnees: { seuil: [], avis: [], incluses: true } } })).not.toContain('alerte-synthese');
    expect(rendu({ alertes: { statut: 'erreur', charge: false, donnees: { seuil: [], avis: [], incluses: true } } })).not.toContain('alerte-synthese');
    expect(rendu({ alertes: etatAlertes({ incluses: false }) })).not.toContain('alerte-synthese');
  });

  it('les alertes de seuil restent avant les avis ; 12 avis → 5 affichés puis « Voir les 7 avis »', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()], avis: Array.from({ length: 12 }, (_, i) => avis(i, 1)) }) });
    expect(html.indexOf('aria-label="Alertes de satisfaction"')).toBeLessThan(html.indexOf('aria-label="Avis à risque"'));
    expect(lignes(html)).toBe(5);
    expect(html).toContain('5 avis affichés sur 12');
    expect(html).toContain('Voir les 7 avis');
    expect(html).toContain('aria-expanded="false"');
  });

  it('exactement 5 avis : aucun bouton', () => {
    const html = rendu({ alertes: etatAlertes({ avis: Array.from({ length: 5 }, (_, i) => avis(i, 1)) }) });
    expect(lignes(html)).toBe(5);
    expect(html).not.toContain('Voir les');
  });

  it('filtres + repli ensemble : le compteur et le bouton suivent le filtre d’agence', () => {
    const mix = [...Array.from({ length: 9 }, (_, i) => avis(i, 1, 'a1')), ...Array.from({ length: 3 }, (_, i) => avis(20 + i, 1, 'a2'))];
    const html = rendu({ isAgencyManager: false, selectedAgenceId: 'a1', alertes: etatAlertes({ avis: mix }) });
    expect(lignes(html)).toBe(5);
    expect(html).toContain('5 avis affichés sur 9');
    expect(html).toContain('Voir les 4 avis');
    expect(html).toContain('Avis clients (9)');
    expect(synthese(html)).toContain('9 situations à surveiller : 9 avis à risque');
    const petit = rendu({ isAgencyManager: false, selectedAgenceId: 'a2', alertes: etatAlertes({ avis: mix }) });
    expect(lignes(petit)).toBe(3);
    expect(petit).not.toContain('Voir les');
  });
});

describe('page /alertes — ligne d’alerte : ordre de lecture, une pastille, niveaux mélangés', () => {
  const mel = (): AlerteFeedback[] => [
    { ...avis(1, 1, 'a1'), raison: 'note_basse_et_sentiment_negatif' },
    { ...avis(2, 3, 'a2'), raison: 'sentiment_negatif' },
  ];
  const ligne = (html: string, feedbackId: string) => (html.match(new RegExp(`<li id="alerte-feedback-${feedbackId}".*?</li>`)) || [''])[0];
  const apres = (html: string, a: string, b: string) => html.indexOf(a) >= 0 && html.indexOf(b) > html.indexOf(a);

  it('avis (CX) : agence et date, puis niveau, puis raison, puis catégorie et note, puis commentaire, puis action — dans le DOM', () => {
    const l = ligne(rendu({ isAgencyManager: false, alertes: etatAlertes({ avis: mel() }) }), 'f1');
    const ordre = ['alerte-ligne__agence', 'alerte-ligne__date', 'Critique', 'alerte-ligne__raison', 'alerte-ligne__meta', 'alerte-ligne__detail', 'alerte-ligne__action'];
    for (let i = 1; i < ordre.length; i++) expect(apres(l, ordre[i - 1], ordre[i]), `${ordre[i - 1]} avant ${ordre[i]}`).toBe(true);
    expect(l).toContain('Note basse et ton négatif');
    expect(l).toContain('Catégorie « Accueil » · Note 1/5');
  });

  it('une seule pastille par ligne (le niveau) ; la raison et la note sont du texte, jamais une seconde pastille', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [{ ...seuil(), gravite: 'critique' }], avis: mel() }) });
    for (const l of [ligne(html, 'f1'), ligne(html, 'f2')]) expect((l.match(/class="ui-badge /g) || []).length).toBe(1);
    const lseuil = (html.match(/<li id="alerte-seuil-.*?<\/li>/) || [''])[0];
    expect((lseuil.match(/class="ui-badge /g) || []).length).toBe(1);
    expect(lseuil).not.toContain('ui-badge--outline');
  });

  it('niveaux mélangés : Critique et À surveiller coexistent, l’ordre critiques d’abord est conservé', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ avis: [...mel().reverse()] }) });
    expect(html.indexOf('alerte-feedback-f1')).toBeLessThan(html.indexOf('alerte-feedback-f2'));
    expect(ligne(html, 'f1')).toContain('ui-badge--critical');
    expect(ligne(html, 'f2')).toContain('ui-badge--warning');
    expect(ligne(html, 'f2')).toContain('>À surveiller<');
  });

  it('Responsable d’agence : pas de nom d’agence dans la ligne d’avis', () => {
    expect(ligne(rendu({ alertes: etatAlertes({ avis: mel() }) }), 'f1')).not.toContain('alerte-ligne__agence');
  });

  it('l’action est un vrai bouton secondaire (zone tactile du design system)', () => {
    const l = ligne(rendu({ alertes: etatAlertes({ avis: mel() }) }), 'f1');
    expect(l).toContain('class="ui-btn ui-btn--secondary ui-btn--sm alerte-ligne__action"');
    expect(l).toContain('Traiter l’avis');
  });

  it('alerte de seuil : agence, puis niveau, puis raison, puis détail, puis action', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [{ ...seuil('a9'), gravite: 'important' }] }) });
    const l = (html.match(/<li id="alerte-seuil-a9".*?<\/li>/) || [''])[0];
    const ordre = ['alerte-ligne__agence', 'Important', 'alerte-ligne__raison', 'alerte-ligne__detail', 'alerte-ligne__action'];
    for (let i = 1; i < ordre.length; i++) expect(apres(l, ordre[i - 1], ordre[i]), `${ordre[i - 1]} avant ${ordre[i]}`).toBe(true);
  });
});

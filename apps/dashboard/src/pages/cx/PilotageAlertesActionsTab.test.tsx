import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Alerte, AlerteFeedback } from '../../types';
import PilotageAlertesActionsTab from './PilotageAlertesActionsTab';
import type { AlertesData } from './AlertesView';
import type { EtatSource } from './alertesVue';

const seuil = (id = 'a1'): Alerte => ({ agence_id: id, agence_nom: `Agence ${id}`, taux_actuel: 50, seuil: 70, message: 'sous le seuil' });
const avis = (i: number, note = 1, agence = 'a1'): AlerteFeedback => ({
  feedback_id: `f${i}`, agence_id: agence, agence_nom: `Agence ${agence}`, note, categorie_nom: 'Accueil', raison: 'note_basse',
  commentaire: `commentaire ${i}`, date_soumission: new Date(Date.now() - i * 3600_000).toISOString(),
});

const etatAlertes = (donnees: Partial<AlertesData> = {}, extra: Partial<EtatSource<AlertesData>> = {}): EtatSource<AlertesData> => ({
  statut: 'pret', charge: true, donnees: { seuil: [], avis: [], incluses: true, ...donnees }, ...extra,
});

const rendu = (surcharge: Partial<React.ComponentProps<typeof PilotageAlertesActionsTab>> = {}, location = '/alertes') =>
  renderToStaticMarkup(
    <StaticRouter location={location}>
      <PilotageAlertesActionsTab
        isAgencyManager
        alertes={etatAlertes()}
        nomForfait={null}
        agences={[]}
        selectedAgenceId={null}
        onSelectAgence={vi.fn()}
        onRefresh={vi.fn()}
        {...surcharge}
      />
    </StaticRouter>,
  );

const occurrences = (html: string, motif: string) => html.split(motif).length - 1;
const synthese = (html: string) => (html.match(/<p class="alerte-synthese">.*?<\/p>/) || [''])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('page /alertes — les six états', () => {
  it('chargement : indicateur accessible, ni liste ni message vide', () => {
    const html = rendu({ alertes: { statut: 'chargement', charge: false, donnees: { seuil: [], avis: [], incluses: true } } });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement des alertes');
    expect(html).not.toContain('Aucune alerte active');
  });

  it('aucune alerte : véritable état vide, coche positive, sans parler des avis (ils sont dans la file)', () => {
    const html = rendu();
    expect(html).toContain('Aucune alerte active');
    expect(html).toContain('var(--color-success)');
    expect(html).toContain('Votre agence maintient un taux de satisfaction supérieur à son seuil.');
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
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()] }, { statut: 'erreur' }) });
    expect(html).toContain('id="alerte-seuil-a1"');
    expect(html).toContain('n’ont pas pu être actualisées');
    expect(html).not.toContain('Aucune alerte active');
  });
});

describe('page /alertes — seulement les alertes de seuil (lot 3)', () => {
  it('les avis à traiter ne sont plus listés ici, même quand l’API en renvoie', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()], avis: [avis(1), avis(2)] }) });
    expect(html).not.toContain('Avis à risque');
    expect(html).not.toContain('alerte-feedback-');
    expect(html).not.toContain('commentaire 1');
    expect(html).not.toContain('Traiter l’avis');
    expect(html).toContain('Satisfaction sous le seuil (1)');
  });

  it('avis seuls côté API : la page dit qu’il n’y a aucune alerte de seuil (les avis sont dans la file)', () => {
    const html = rendu({ alertes: etatAlertes({ avis: [avis(1)] }) });
    expect(html).toContain('Aucune alerte active');
    expect(html).not.toContain('alerte-synthese');
  });

  it('plus de choix de type d’alerte : il n’en reste qu’un', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()] }) });
    expect(html).not.toContain('aria-label="Type d&#x27;alerte"');
    expect(html).not.toMatch(/Avis clients \(\d+\)/);
  });

  it('renvoi vers la file « À traiter » de la page Avis, avec son compteur', () => {
    const html = rendu({ avisATraiter: 3 });
    expect(html).toContain('<b class="alerte-synthese__n">3</b> avis à traiter');
    expect(html).toContain('href="/feedbacks?filtre=a-traiter"');
    expect(html).toContain('Voir les avis à traiter');
    expect(rendu({ avisATraiter: 0 })).toContain('rien en attente');
  });

  it('compteur inconnu : jamais de « 0 » inventé, seulement le renvoi', () => {
    const html = rendu({ avisATraiter: null });
    expect(html).not.toMatch(/>0<\/b> avis à traiter/);
    expect(html).toContain('Les avis qui demandent un geste sont dans la file « À traiter » de la page Avis.');
  });

  it('CX Manager filtré sur une agence : le renvoi garde l’agence', () => {
    const html = rendu({ isAgencyManager: false, selectedAgenceId: 'a7', avisATraiter: 2 });
    expect(html).toContain('href="/feedbacks?filtre=a-traiter&amp;agence=a7"');
  });
});

describe('page /alertes — hiérarchie et filtres', () => {
  it('l’ancre de seuil (liens existants) est conservée', () => {
    expect(rendu({ alertes: etatAlertes({ seuil: [seuil('a9')] }) })).toContain('id="alerte-seuil-a9"');
  });

  it('sélecteur d’agence réservé au CX Manager, avec un nom accessible', () => {
    expect(rendu({ isAgencyManager: true })).not.toContain('<select');
    const cx = rendu({ isAgencyManager: false, agences: [{ id: 'a1', nom: 'Agence a1' } as never] });
    expect(cx).toContain('<select');
    expect(cx).toContain('aria-label="Filtrer les alertes par agence"');
  });

  it('filtre d’agence sans résultat alors que des alertes existent : icône neutre et message distinct avec le total', () => {
    const html = rendu({ isAgencyManager: false, selectedAgenceId: 'autre', alertes: etatAlertes({ seuil: [seuil()] }) });
    expect(html).toContain('Aucune alerte pour cette agence');
    expect(html).toContain('1 alerte au total');
    expect(html).toContain('Réinitialiser le filtre');
    expect(html).toContain('alerte-vide-filtre');
  });

  it('la phrase de seuil est écrite UNE fois par groupe, pas par ligne', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('a1'), seuil('a2'), seuil('a3')] }) });
    expect(occurrences(html, 'Chaque alerte est affichée après 48 h sous le seuil')).toBe(1);
    expect(rendu({ alertes: etatAlertes({ seuil: [seuil('a1'), seuil('a2')] }) })).toContain('Chaque alerte disparaît quand la satisfaction des 7 derniers jours repasse au-dessus du seuil.');
  });

  it('titre de groupe sans majuscules intégrales', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('a1'), seuil('a2')] }) });
    expect(html).toContain('<h3 class="alerte-groupe-titre">Satisfaction sous le seuil (2)</h3>');
  });
});

describe('page /alertes — liens', () => {
  it('alerte de seuil : le CX ouvre l’agence, le Responsable analyse la tendance', () => {
    expect(rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('agence-9')] }) })).toContain('href="/agences/agence-9/apercu"');
    expect(rendu({ alertes: etatAlertes({ seuil: [seuil('agence-9')] }) })).toContain('href="/statistiques"');
  });

  it('une alerte n’est jamais déclarée résolue par l’interface : aucun bouton « résoudre » ni « acquitter »', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil()] }) });
    expect(html).not.toMatch(/Résoudre|Acquitter|Marquer l’alerte|Clôturer/);
  });

  it('plus d’encadré d’aide ni de recommandations dans la page', () => {
    for (const html of [rendu({ alertes: etatAlertes({ seuil: [seuil()] }) }), rendu({ isAgencyManager: false })]) {
      expect(html).not.toContain('<details');
      expect(html).not.toContain('ui-alert--info');
      expect(html).not.toMatch(/[Rr]ecommandation/);
    }
  });
});

describe('page /alertes — synthèse', () => {
  it('bande compacte, chiffres en <b>, pas de carte KPI', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [seuil('a1'), seuil('a2')] }) });
    expect(synthese(html)).toBe('2 alertes actives : 2 alertes de seuil 2 agences concernées');
    expect(html).toContain('<b class="alerte-synthese__n">2</b>');
    expect(html).not.toContain('ui-kpi');
  });

  it('Responsable d’agence : pas d’« agences concernées »', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [seuil('a1')] }) });
    expect(synthese(html)).toBe('1 alerte active : 1 alerte de seuil');
  });

  it('absente en chargement, en erreur, sans forfait et sans alerte (jamais de « 0 situation »)', () => {
    expect(rendu()).not.toContain('alerte-synthese');
    expect(rendu({ alertes: { statut: 'chargement', charge: false, donnees: { seuil: [], avis: [], incluses: true } } })).not.toContain('alerte-synthese');
    expect(rendu({ alertes: { statut: 'erreur', charge: false, donnees: { seuil: [], avis: [], incluses: true } } })).not.toContain('alerte-synthese');
    expect(rendu({ alertes: etatAlertes({ incluses: false }) })).not.toContain('alerte-synthese');
  });
});

describe('page /alertes — ligne d’alerte de seuil', () => {
  const apres = (html: string, a: string, b: string) => html.indexOf(a) >= 0 && html.indexOf(b) > html.indexOf(a);

  it('agence, puis niveau, puis raison, puis détail, puis action ; une seule pastille', () => {
    const html = rendu({ isAgencyManager: false, alertes: etatAlertes({ seuil: [{ ...seuil('a9'), gravite: 'important' }] }) });
    const l = (html.match(/<li id="alerte-seuil-a9".*?<\/li>/) || [''])[0];
    const ordre = ['alerte-ligne__agence', 'Élevée', 'alerte-ligne__raison', 'alerte-ligne__detail', 'alerte-ligne__action'];
    for (let i = 1; i < ordre.length; i++) expect(apres(l, ordre[i - 1], ordre[i]), `${ordre[i - 1]} avant ${ordre[i]}`).toBe(true);
    expect((l.match(/class="ui-badge /g) || []).length).toBe(1);
    expect(l).toContain('class="ui-btn ui-btn--secondary ui-btn--sm alerte-ligne__action"');
  });

  it('le rouge n’apparaît que dans le badge de niveau : ni bordure rose sur la carte, ni liseré sur la ligne', () => {
    const html = rendu({ alertes: etatAlertes({ seuil: [{ ...seuil(), gravite: 'critique' }] }) });
    expect(html).not.toContain('ui-card--critical');
    expect(html).not.toContain('agence-prio__item--critical');
    expect((html.match(/critical/g) || []).length).toBe((html.match(/ui-badge--critical/g) || []).length);
  });
});

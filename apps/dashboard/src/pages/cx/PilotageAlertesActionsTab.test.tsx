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
    expect(html).toContain('Note basse · 1/5');
    expect(html).toContain('pour un seuil de 70 %');
  });
});

describe('page /alertes — hiérarchie, volume et filtres', () => {
  it('au plus dix avis visibles, le total et le dépliage sont annoncés', () => {
    const beaucoup = Array.from({ length: 25 }, (_, i) => avis(i, 3));
    const html = rendu({ alertes: etatAlertes({ avis: beaucoup }) });
    expect((html.match(/id="alerte-feedback-/g) || []).length).toBe(AVIS_VISIBLES);
    expect(html).toContain(`${AVIS_VISIBLES} avis affichés sur 25`);
    expect(html).toContain('Afficher les 15 autres avis');
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
    expect(html).toContain('1 critique');
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
    expect(html).toContain('Disparaît quand l’avis est marqué comme résolu');
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

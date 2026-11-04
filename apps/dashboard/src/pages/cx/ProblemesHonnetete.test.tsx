import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue, KPIResult } from '../../types';
import PilotageActionsTab from './PilotageActionsTab';
import { FILTRES_ACTIONS_PAR_DEFAUT, TEXTE_VIDE_EN_COURS_AGENCE, TEXTE_VIDE_EN_COURS_RESEAU } from '../../utils/actionsUnifiees';
import PilotageIssuesTab from './PilotageIssuesTab';
import { FILTRES_PAR_DEFAUT } from '../../utils/problemesListe';
import KpiCoreGrid, { CODES_BANDEAU, LigneBandeau } from '../../components/kpi/KpiCoreGrid';
import { Action } from './siege/SiegeBlocks';
import { bilanProblemesOuverts } from './siege/siegeData';
import { fetchIssuesOuvertes } from './siege/useSiegeData';
import { etatNonRenseigne } from '../../utils/kpiFormat';

// Appels API simulés : par statut, la réponse porte (ou non) l'en-tête X-Total-Count.
const api = vi.hoisted(() => ({ liste: vi.fn(), kpis: vi.fn() }));
vi.mock('../../services/api', () => ({
  issuesApi: { list: (...a: unknown[]) => api.liste(...a), get: vi.fn(), terminerAction: vi.fn(), verifier: vi.fn() },
  kpisApi: { list: (...a: unknown[]) => api.kpis(...a) },
  feedbacksApi: {},
}));

beforeEach(() => { api.liste.mockReset(); });

const issue = (statut: Issue['statut'], flag: boolean, id = Math.random().toString(36)): Issue =>
  ({ id, agence_id: 'a1', agence_nom: 'Agence A1', titre: `Problème ${id}`, statut, severite: 'moyenne', necessite_action: flag, premiere_detection: new Date().toISOString() } as unknown as Issue);

const kpi = (s: Partial<KPIResult> & { code: string }): KPIResult =>
  ({ label: s.code, unit: 'percent', status: 'ok', value: 50, numerator: 1, denominator: 2, verified_count: null, requiring_action_count: null, famille: 'commun_prioritaire', ...s } as KPIResult);

// ── 2. Le compteur « sans action / avec action » ──────────────────────────────────────────────────────

describe('problèmes ouverts : bilan fidèle à ce que chaque statut veut dire', () => {
  it('ouverte + rouverte = sans action en cours ; action_en_cours = avec une action en cours', () => {
    const bilan = bilanProblemesOuverts({ ouverte: { total: 2, fiable: true }, action_en_cours: { total: 1, fiable: true }, reouverte: { total: 3, fiable: true } });
    expect(bilan).toEqual({ sansAction: 5, avecAction: 1, approximatif: false });
  });

  it('un total non fiable rend le bilan approximatif (« ≥ »)', () => {
    expect(bilanProblemesOuverts({ ouverte: { total: 200, fiable: false }, action_en_cours: { total: 0, fiable: true }, reouverte: { total: 0, fiable: true } }).approximatif).toBe(true);
  });

  it('les totaux viennent de X-Total-Count (exacts même si la liste chargée est tronquée), jamais du drapeau necessite_action', async () => {
    api.liste.mockImplementation(async ({ statut }: { statut: string }) => ({
      data: statut === 'ouverte' ? [issue('ouverte', true), issue('ouverte', true)] : statut === 'action_en_cours' ? [issue('action_en_cours', false)] : [],
      headers: { 'x-total-count': statut === 'ouverte' ? '350' : statut === 'action_en_cours' ? '1' : '0' },
    }));
    const r = await fetchIssuesOuvertes();
    expect(r.parStatut).toEqual({ ouverte: { total: 350, fiable: true }, action_en_cours: { total: 1, fiable: true }, reouverte: { total: 0, fiable: true } });
    expect(r.tronquee).toBe(true);
    expect(bilanProblemesOuverts(r.parStatut)).toEqual({ sansAction: 350, avecAction: 1, approximatif: false });   // les drapeaux (true sur « ouverte ») sont ignorés
  });

  it('sans en-tête : le nombre de lignes reçues si la liste n’est pas pleine ; « non fiable » si elle l’est', async () => {
    api.liste.mockImplementation(async ({ statut }: { statut: string }) => ({
      data: statut === 'ouverte' ? Array.from({ length: 200 }, () => issue('ouverte', false)) : statut === 'action_en_cours' ? [issue('action_en_cours', true)] : [],
      headers: {},
    }));
    const r = await fetchIssuesOuvertes();
    expect(r.parStatut.action_en_cours).toEqual({ total: 1, fiable: true });
    expect(r.parStatut.ouverte).toEqual({ total: 200, fiable: false });
    expect(bilanProblemesOuverts(r.parStatut).approximatif).toBe(true);
  });

  it('transmet le périmètre (agence) à chaque appel', async () => {
    api.liste.mockResolvedValue({ data: [], headers: { 'x-total-count': '0' } });
    await fetchIssuesOuvertes('agence-7');
    expect(api.liste).toHaveBeenCalledTimes(3);
    for (const [params] of api.liste.mock.calls) expect(params).toMatchObject({ agence_id: 'agence-7', limit: 200 });
  });

  const bloc = (parStatut: Parameters<typeof bilanProblemesOuverts>[0]) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <Action
          actions={{ status: 'ok', data: { enCours: 0, realisees: 0 } }}
          issues={{ status: 'ok', data: { items: [], total: 0, tronquee: false, parStatut } }}
          onRetryActions={() => undefined}
          onRetryIssues={() => undefined}
        />
      </MemoryRouter>,
    );

  it('Vue d’ensemble : deux libellés exacts, plus aucun « nécessitant une action »', () => {
    // Situation de la base de démonstration : 2 « ouverte » (sans action), 1 « action_en_cours ».
    const html = bloc({ ouverte: { total: 2, fiable: true }, action_en_cours: { total: 1, fiable: true }, reouverte: { total: 0, fiable: true } });
    expect(html).toContain('Problèmes sans action en cours');
    expect(html).toContain('Problèmes avec une action en cours');
    expect(html).not.toContain('nécessitant une action');
    expect(html).toMatch(/siege-stat__value">2<\/span><span class="siege-stat__label">Problèmes sans action en cours/);
    expect(html).toMatch(/siege-stat__value">1<\/span><span class="siege-stat__label">Problèmes avec une action en cours/);
    expect(html).toContain('/issues');                                         // le lien vers les problèmes reste
  });

  it('total approximatif : « ≥ »', () => {
    expect(bloc({ ouverte: { total: 200, fiable: false }, action_en_cours: { total: 0, fiable: true }, reouverte: { total: 0, fiable: true } })).toContain('≥ 200');
  });
});

// ── 3. « Non renseigné » ───────────────────────────────────────────────────────────────────────────────

describe('indicateurs qui reposent sur une donnée que l’interface ne produit pas encore', () => {
  const sans = (code: string, extra: Partial<KPIResult> = {}) => kpi({ code, status: 'no_data', value: null, numerator: null, denominator: null, ...extra });

  it('durée de résolution, boucle fermée, délai (SLA) sans valeur : « Non renseigné » + phrase exacte, jamais « Aucune donnée / pas assez de données »', () => {
    for (const code of ['MEDIAN_RESOLUTION_TIME', 'LOOP_CLOSURE_RATE', 'SLA_COMPLIANCE_RATE']) {
      const e = etatNonRenseigne(sans(code));
      expect(e?.valeur).toBe('Non renseigné');
      expect(e?.sousTitre).toMatch(/^Aucun problème/);
      expect(e?.sousTitre).not.toContain('Pas assez de données');
    }
  });

  it('un indicateur réellement calculé garde sa valeur (aucune donnée masquée)', () => {
    expect(etatNonRenseigne(kpi({ code: 'MEDIAN_RESOLUTION_TIME', value: 48, unit: 'hours', denominator: 8 }))).toBeNull();
    expect(etatNonRenseigne(kpi({ code: 'LOOP_CLOSURE_RATE', value: 33.3, numerator: 3, denominator: 9, verified_count: 3, requiring_action_count: 9 }))).toBeNull();
    expect(etatNonRenseigne(kpi({ code: 'SLA_COMPLIANCE_RATE', value: 0, numerator: 0, denominator: 4 }))).toBeNull();           // 0 % avec une base réelle : vrai
    expect(etatNonRenseigne(kpi({ code: 'ISSUE_RESOLUTION_RATE', value: 72.7, numerator: 8, denominator: 11 }))).toBeNull();
    expect(etatNonRenseigne(kpi({ code: 'CSAT', value: 0, numerator: 0, denominator: 4 }))).toBeNull();                       // hors sujet : jamais touché
  });

  it('taux de résolution à zéro : pas « 0 % » mais « Non renseigné » avec la base', () => {
    expect(etatNonRenseigne(kpi({ code: 'ISSUE_RESOLUTION_RATE', value: 0, numerator: 0, denominator: 5 }))?.sousTitre).toBe('Aucun problème résolu pour l’instant, sur 5 enregistrés.');
    expect(etatNonRenseigne(kpi({ code: 'ISSUE_RESOLUTION_RATE', value: 0, numerator: 0, denominator: 1 }))?.sousTitre).toBe('Aucun problème résolu pour l’instant, sur 1 enregistré.');
  });

  it('récurrence à zéro (numérateur nul) : « Non renseigné » ; sans valeur (moins de 5 résolus) : message habituel, car la cause n’est pas l’absence de lien', () => {
    for (const code of ['ISSUE_RECURRENCE_RATE', 'RESTO_RECIDIVE_CATEGORIE', 'TEL_RECURRENCE_AGENCE', 'TEL_RECURRENCE_HORS_PERIMETRE']) {
      expect(etatNonRenseigne(kpi({ code, value: 0, numerator: 0, denominator: 9 }))?.sousTitre).toContain('relié à un problème antérieur');
      expect(etatNonRenseigne(kpi({ code, value: 37.5, numerator: 3, denominator: 8 }))).toBeNull();
      expect(etatNonRenseigne(sans(code, { numerator: 1, denominator: 3 }))).toBeNull();
    }
  });

  it('aucune phrase ne contient de chiffre inventé : seuls les nombres de la réponse apparaissent', () => {
    for (const code of ['MEDIAN_RESOLUTION_TIME', 'LOOP_CLOSURE_RATE', 'SLA_COMPLIANCE_RATE']) expect(etatNonRenseigne(sans(code))?.sousTitre).not.toMatch(/\d/);
  });

  it('bandeau court : les 4 indicateurs, valeur ou « Non renseigné » + explication', () => {
    const kpis = [
      kpi({ code: 'ISSUE_VOLUME', unit: 'count', value: 11 }),
      kpi({ code: 'CRITICAL_ISSUE_RATE', value: 36.4 }),
      kpi({ code: 'ISSUE_RESOLUTION_RATE', value: 0, numerator: 0, denominator: 11 }),
      sans('LOOP_CLOSURE_RATE'),
      kpi({ code: 'CSAT', value: 55.6 }),
    ];
    const html = renderToStaticMarkup(<LigneBandeau kpis={kpis} jours={30} />);
    expect(html.match(/kpi-bandeau__item/g)).toHaveLength(CODES_BANDEAU.length);
    expect(html).toContain('>11<');
    expect(html.match(/Non renseigné/g)).toHaveLength(2);
    expect(html).toContain('Aucun problème résolu pour l’instant, sur 11 enregistrés.');
    expect(html).toContain('le taux se calcule dès qu’une action existe');
    expect(html).not.toContain('55,6');                                          // le bandeau ne montre que les indicateurs de problèmes
  });
});

// ── 1. La liste avant les indicateurs ─────────────────────────────────────────────────────────────────

describe('onglet « Problèmes à traiter » : la liste passe avant les indicateurs', () => {
  const props = (surcharge: Record<string, unknown> = {}) => ({
    isAgencyManager: false, agencesList: [], issuesJours: 30, setIssuesJours: () => undefined, issuesAgenceId: null, setIssuesAgenceId: () => undefined,
    filtres: FILTRES_PAR_DEFAUT, setFiltres: () => undefined, issuesKpisRefreshToken: 0, issuesFirstLoadDone: true, issuesListRaw: [issue('ouverte', false, 'a')],
    issuesTotal: 1, issuesListError: false, issuesListLoading: false, fetchIssuesList: async () => undefined, openIssueDetail: async () => undefined,
    issuesLoadingMore: false, loadMoreIssues: async () => undefined, selectedIssueId: null, issueDetail: null, issueDetailLoading: false, closeIssueDetail: () => undefined,
    apresActionIssue: async () => undefined, verifierIssue: async () => undefined, ...surcharge,
  });
  const rendre = (surcharge?: Record<string, unknown>) =>
    renderToStaticMarkup(<MemoryRouter><PilotageIssuesTab {...(props(surcharge) as unknown as React.ComponentProps<typeof PilotageIssuesTab>)} /></MemoryRouter>);

  it('la liste est dans le HTML AVANT le bandeau d’indicateurs', () => {
    const html = rendre();
    const liste = html.indexOf('id="issues-liste"');
    const indicateurs = html.indexOf('kpi-bandeau');
    const chargement = html.indexOf('Chargement des indicateurs');
    expect(liste).toBeGreaterThan(-1);
    expect(Math.max(indicateurs, chargement)).toBeGreaterThan(liste);
    expect(html).toContain('Problème a');
  });

  it('même ordre pendant le chargement de la liste et quand la liste est vide', () => {
    for (const s of [{ issuesListLoading: true }, { issuesListRaw: [], issuesTotal: 0 }]) {
      const html = rendre(s);
      expect(html.indexOf('id="issues-liste"')).toBeGreaterThan(-1);
      expect(html.indexOf('id="issues-liste"')).toBeLessThan(html.indexOf('Chargement des indicateurs'));
    }
  });

  it('le bandeau d’indicateurs en chargement : 4 emplacements, pas 8 cartes', () => {
    const html = renderToStaticMarkup(<KpiCoreGrid mode="bandeau" jours={30} />);
    expect(html).toContain('Chargement des indicateurs');
    expect(html.match(/ui-skeleton/g)?.length).toBe(CODES_BANDEAU.length);
    expect(renderToStaticMarkup(<KpiCoreGrid jours={30} />).match(/ui-skeleton/g)?.length).toBe(8);               // le mode complet est inchangé
  });
});

// ── 4. « Actions à mener » : l'état vide dit ce que fait la page ───────────────────────────────────────

describe('« Actions à mener » : état vide exact', () => {
  const props = (surcharge: Record<string, unknown> = {}) => ({ isAgencyManager: false, agencesList: [], filtres: FILTRES_ACTIONS_PAR_DEFAUT, setFiltres: () => undefined, lignes: [], total: 0, autreTotal: 0, chargement: false, premierChargement: true, erreur: false, chargementSuite: false, partiel: false, recharger: () => undefined, chargerSuite: () => undefined, confirmerAvis: async () => undefined, apresTerminaison: async () => undefined, openIssueDetail: async () => undefined, selectedIssueId: null, issueDetail: null, issueDetailLoading: false, closeIssueDetail: () => undefined, apresActionIssue: async () => undefined, verifierIssue: async () => undefined, ...surcharge,
  });
  const rendre = (surcharge?: Record<string, unknown>) =>
    renderToStaticMarkup(<MemoryRouter><PilotageActionsTab {...(props(surcharge) as unknown as React.ComponentProps<typeof PilotageActionsTab>)} /></MemoryRouter>);

  it('CX Manager : une action apparaît quand il la définit sur un problème ou sur un avis déjà pris en charge', () => {
    const html = rendre();
    expect(html).toContain(TEXTE_VIDE_EN_COURS_RESEAU);
    expect(TEXTE_VIDE_EN_COURS_RESEAU).toContain('vous la définissez sur un problème');
    expect(TEXTE_VIDE_EN_COURS_RESEAU).toContain('sur un avis déjà pris en charge par le Responsable d’agence');
  });

  it('Agency Manager : son CX Manager définit l’action sur un problème de l’agence ou sur un avis qu’il a pris en charge', () => {
    const html = rendre({ isAgencyManager: true });
    expect(html).toContain(TEXTE_VIDE_EN_COURS_AGENCE);
    expect(TEXTE_VIDE_EN_COURS_AGENCE).toContain('votre CX Manager la définit sur un problème de votre agence');
    expect(TEXTE_VIDE_EN_COURS_AGENCE).toContain('sur un avis que vous avez pris en charge');
  });

  it('plus aucune promesse de « regrouper » ou de « lancer » une action', () => {
    for (const html of [rendre(), rendre({ isAgencyManager: true })]) {
      expect(html).not.toContain('regrouper');
      expect(html).not.toContain('lancer une action');
      expect(html).not.toContain('revient dans une agence');
    }
    expect(`${TEXTE_VIDE_EN_COURS_RESEAU}${TEXTE_VIDE_EN_COURS_AGENCE}`).not.toMatch(/regrouper|lancer/);
  });

  it('le reste de l’état vide : titre, liste « Terminées » et filtres', () => {
    expect(rendre()).toContain('Aucune action en cours');
    expect(rendre({ filtres: { ...FILTRES_ACTIONS_PAR_DEFAUT, segment: 'terminees' } })).toContain('Aucune action terminée pour l’instant');
    expect(rendre({ filtres: { ...FILTRES_ACTIONS_PAR_DEFAUT, agenceId: 'a1' } })).toContain('Aucune action pour ces filtres');
  });
});

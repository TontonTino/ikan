import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../types';
import { construirePriorites, estProblemePrioritaire } from '../../components/agency/agenceVue';
import PilotageIssuesTab from './PilotageIssuesTab';
import { buildSurveillance } from './siege/siegeData';
import { issuesIncompletes } from './siege/useSiegeData';
import { estSansActionEnCours, ilYA, libelleEnregistre } from '../../utils/issueSuivi';

const JOUR = 86_400_000;
const MAINTENANT = new Date('2026-11-04T12:00:00Z').getTime();
const il = (jours: number) => new Date(MAINTENANT - jours * JOUR).toISOString();

const OUAGA: [string, string] = ['a-ouaga', 'Le Prestige Ouaga 2000'];
const ZONE: [string, string] = ['a-zone', 'Le Prestige Zone du Bois'];

const issue = (id: string, statut: Issue['statut'], severite: Issue['severite'], flag: boolean, agence: [string, string] = ['a1', 'Agence A1']): Issue =>
  ({ id, agence_id: agence[0], agence_nom: agence[1], titre: `Problème ${id}`, statut, severite, necessite_action: flag, premiere_detection: il(1) } as unknown as Issue);

// Les problèmes de la base de démonstration locale, tels que l'API les renvoie : statut et drapeau `necessite_action` (posé à la création d'une action).
const DEMO = [
  issue('climatisation', 'action_en_cours', 'critique', true, OUAGA),      // critique, action en cours
  issue('reservation', 'ouverte', 'elevee', false, OUAGA),                 // élevée, aucune action
  issue('eclairage', 'action_en_cours', 'moyenne', true, OUAGA),           // moyenne, action en cours (déjà prise en charge)
  issue('attente', 'ouverte', 'moyenne', false, OUAGA),                    // moyenne, aucune action (attend une décision)
  issue('proprete', 'ouverte', 'critique', false, ZONE),                   // critique, aucune action
];

describe('« sans action en cours » : le statut, jamais le drapeau', () => {
  it('ouverte et rouverte attendent une décision ; les autres non', () => {
    expect(estSansActionEnCours('ouverte')).toBe(true);
    expect(estSansActionEnCours('reouverte')).toBe(true);
    for (const s of ['action_en_cours', 'resolue', 'verifiee'] as const) expect(estSansActionEnCours(s)).toBe(false);
  });
});

describe('règle de priorité de l’Agency Manager', () => {
  it('table de vérité : grave ou sans action, et ouvert', () => {
    const p = (statut: Issue['statut'], sev: Issue['severite'], flag: boolean) => estProblemePrioritaire(issue('x', statut, sev, flag));
    expect(p('ouverte', 'moyenne', false)).toBe(true);           // avant : false (drapeau absent)
    expect(p('reouverte', 'faible', true)).toBe(true);
    expect(p('action_en_cours', 'moyenne', true)).toBe(false);   // avant : true (drapeau posé) : déjà pris en charge, peu grave
    expect(p('action_en_cours', 'faible', true)).toBe(false);
    expect(p('action_en_cours', 'critique', true)).toBe(true);   // les graves restent prioritaires, avec ou sans action
    expect(p('action_en_cours', 'elevee', true)).toBe(true);
    expect(p('resolue', 'critique', true)).toBe(false);
    expect(p('verifiee', 'critique', false)).toBe(false);
  });

  it('exemple de la base de démonstration : « Attente au déjeuner » entre, « Éclairage défaillant » sort', () => {
    const ouaga = DEMO.filter((i) => i.agence_id === 'a-ouaga');
    const ids = construirePriorites({ alertes: [], avis: [], problemes: ouaga }).map((x) => x.id).sort();
    expect(ids).toEqual(['probleme-attente', 'probleme-climatisation', 'probleme-reservation']);                         // après
    // Avant (drapeau) : climatisation, reservation (élevée), eclairage (drapeau posé) ; « attente » (moyenne, aucune action) était ratée.
    const ouverts = ['ouverte', 'action_en_cours', 'reouverte'];
    const avant = ouaga.filter((i) => ouverts.includes(i.statut) && (i.severite === 'critique' || i.severite === 'elevee' || i.necessite_action)).map((i) => i.id).sort();
    expect(avant).toEqual(['climatisation', 'eclairage', 'reservation']);
  });
});

describe('signal « À surveiller » : problèmes critiques ou élevés sans action en cours', () => {
  const surveiller = (issues: Issue[], incompletes = false) => buildSurveillance({ ranking: [], alertesSeuil: [], issuesOuvertes: issues, issuesIncompletes: incompletes, jours: 30 });
  const signal = (l: ReturnType<typeof surveiller>, agence: string) => l.lignes.find((x) => x.agence_id === agence)?.signaux.find((s) => s.type === 'issues');

  it('inclut les critiques/élevés ouverts et rouverts sans action ; exclut ceux qui ont une action en cours', () => {
    const l = surveiller(DEMO);
    expect(signal(l, 'a-zone')?.texte).toBe('1 problème sans action en cours (dont 1 critique)');                     // « proprete » : ratée avant
    expect(signal(l, 'a-ouaga')?.texte).toBe('1 problème sans action en cours');                                      // « reservation » (élevée) ; « climatisation » a une action
    expect(signal(l, 'a-ouaga')?.portee).toBe('gravité critique ou élevée');
  });

  it('avant (drapeau) : le seul problème retenu était celui qui a déjà une action', () => {
    const avant = DEMO.filter((i) => i.necessite_action && (i.severite === 'critique' || i.severite === 'elevee')).map((i) => i.id);
    expect(avant).toEqual(['climatisation']);
  });

  it('rouvert critique sans action : inclus', () => {
    expect(signal(surveiller([issue('r', 'reouverte', 'critique', true, ZONE)]), 'a-zone')?.texte).toBe('1 problème sans action en cours (dont 1 critique)');
  });

  it('modérés et faibles : jamais dans ce signal', () => {
    expect(surveiller([issue('m', 'ouverte', 'moyenne', false), issue('f', 'ouverte', 'faible', true)]).total).toBe(0);
  });

  it('pluriel et décompte des critiques', () => {
    const l = surveiller([issue('1', 'ouverte', 'critique', false), issue('2', 'ouverte', 'elevee', false), issue('3', 'reouverte', 'critique', false)]);
    expect(signal(l, 'a1')?.texte).toBe('3 problèmes sans action en cours (dont 2 critiques)');
  });

  it('liste incomplète (tronquée) : « ≥ » devant le nombre, jamais un nombre exact trompeur', () => {
    expect(signal(surveiller([issue('1', 'ouverte', 'critique', false)], true), 'a1')?.texte).toBe('≥ 1 problème sans action en cours (dont 1 critique)');
  });

  it('exhaustivité : la liste est complète si aucun statut n’est tronqué et que tous les totaux sont lus', () => {
    const complet = { items: [], total: 0, tronquee: false, parStatut: { ouverte: { total: 1, fiable: true }, action_en_cours: { total: 0, fiable: true }, reouverte: { total: 0, fiable: true } } };
    expect(issuesIncompletes(complet)).toBe(false);
    expect(issuesIncompletes({ ...complet, tronquee: true })).toBe(true);
    expect(issuesIncompletes({ ...complet, parStatut: { ...complet.parStatut, ouverte: { total: 200, fiable: false } } })).toBe(true);
  });
});

describe('« Enregistré aujourd’hui » et dates à la convention', () => {
  it('« aujourd’hui » ou « il y a N jours » : jamais « il y a aujourd’hui »', () => {
    expect(ilYA(0)).toBe('aujourd’hui');
    expect(ilYA(1)).toBe('il y a 1 jour');
    expect(ilYA(5)).toBe('il y a 5 jours');
  });

  it('date d’enregistrement : relative jusqu’à 30 jours, puis « le 24 oct. 2026 »', () => {
    expect(libelleEnregistre(il(0), MAINTENANT)).toBe('aujourd’hui');
    expect(libelleEnregistre(il(2), MAINTENANT)).toBe('il y a 2 jours');
    expect(libelleEnregistre(il(30), MAINTENANT)).toBe('il y a 30 jours');
    expect(libelleEnregistre('2026-09-20T10:00:00Z', MAINTENANT)).toBe('le 20 sept. 2026');
    expect(libelleEnregistre('pas une date', MAINTENANT)).toBe('');
  });

  const props = (liste: Issue[]) => ({
    isAgencyManager: false, agencesList: [], issuesJours: 90, setIssuesJours: () => undefined, issuesAgenceId: null, setIssuesAgenceId: () => undefined,
    backlogActif: false, setBacklogActif: () => undefined, issuesKpisRefreshToken: 0, issuesFirstLoadDone: true, issuesAffichees: liste, issuesListRaw: liste,
    issuesTotal: liste.length, ancienneteTexte: null, issuesListError: false, issuesListLoading: false, fetchIssuesList: async () => undefined, openIssueDetail: async () => undefined,
    issuesLoadingMore: false, loadMoreIssues: async () => undefined, selectedIssueId: null, issueDetail: null, issueDetailLoading: false, closeIssueDetail: () => undefined,
    terminerActionIssue: async () => undefined, verifierIssue: async () => undefined,
  });
  const rendre = (liste: Issue[]) =>
    renderToStaticMarkup(<MemoryRouter><PilotageIssuesTab {...(props(liste) as unknown as React.ComponentProps<typeof PilotageIssuesTab>)} /></MemoryRouter>);

  it('la liste : « Enregistré aujourd’hui », dates dans <time> avec la date complète au survol, plus aucun jj/mm/aaaa', () => {
    const recent = { ...issue('r', 'ouverte', 'moyenne', false), premiere_detection: new Date().toISOString() } as Issue;
    const ancien = { ...issue('a', 'resolue', 'moyenne', true), premiere_detection: '2026-09-20T10:00:00Z' } as Issue;
    const avecDelai = { ...issue('d', 'ouverte', 'moyenne', false), premiere_detection: new Date().toISOString(), date_limite_sla: new Date(Date.now() + 9 * JOUR).toISOString() } as Issue;
    const html = rendre([recent, ancien, avecDelai]);
    expect(html).toContain('Enregistré <time');
    expect(html).toContain('>aujourd’hui</time>');
    expect(html).not.toContain('il y a aujourd’hui');
    expect(html).toContain('>le 20 sept. 2026</time>');
    expect(html).toContain('title="20 septembre 2026 à ');
    expect(html).toMatch(/À traiter avant le <time[^>]*>\d{1,2} \S+ 20\d\d<\/time>/);
    expect(html).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

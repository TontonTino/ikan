import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Issue, IssueDetail, IssueStatut, UserRole } from '../../types';

const etat = vi.hoisted(() => ({ user: { id: 'moi', role: 'cx_manager', prenom: 'Awa', nom: 'Sawadogo' } as unknown }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));

import { ProblemesCartes, ProblemesTableau, CelluleEcheance, idLigneProbleme } from './ProblemesTableau';
import ProblemesFiltres from './ProblemesFiltres';
import PanneauProbleme from './PanneauProbleme';
import { PiedProbleme } from './IssueDetailContenu';
import PilotageIssuesTab from '../../pages/cx/PilotageIssuesTab';
import { FILTRES_PAR_DEFAUT } from '../../utils/problemesListe';

const MAINTENANT = Date.now();
const JOUR = 86_400_000;
const il = (jours: number) => new Date(MAINTENANT - jours * JOUR).toISOString();
const dans = (jours: number) => new Date(MAINTENANT + jours * JOUR).toISOString();

const issue = (id: string, extra: Partial<Issue> = {}): Issue =>
  ({ id, organisation_id: 'o', agence_id: 'ag1', agence_nom: 'Agence Ouaga', titre: `Problème ${id}`, statut: 'ouverte', severite: 'elevee', necessite_action: false,
     premiere_detection: il(2), created_at: il(2), updated_at: il(2), nb_avis: 2, nb_actions: 0, nb_actions_a_faire: 0, prochaine_echeance: null, en_retard: null, ...extra } as unknown as Issue);

const LISTE = [
  issue('a', { en_retard: true, date_limite_sla: il(3), nb_actions: 2, nb_actions_a_faire: 1, prochaine_echeance: dans(6), statut: 'action_en_cours', severite: 'critique' }),
  issue('b'),
  issue('c', { nb_actions: 1, nb_actions_a_faire: 1, prochaine_echeance: null, statut: 'action_en_cours', en_retard: false, date_limite_sla: dans(4) }),
];

const commun = { issues: LISTE, afficherAgence: true, ouvertId: null as string | null, onOuvrir: () => undefined, maintenant: MAINTENANT };

describe('tableau des problèmes (ordinateur)', () => {
  const html = (p: Partial<typeof commun> = {}) => renderToStaticMarkup(<ProblemesTableau {...commun} {...p} />);

  it('colonnes utiles seulement, une ligne par problème', () => {
    const h = html();
    for (const colonne of ['Problème', 'Urgence', 'État', 'Actions', 'Échéance']) expect(h).toContain(`>${colonne}</th>`);
    expect(h.match(/<tr id="pb-ligne-/g)).toHaveLength(3);
    expect(h).toContain('<table');
  });

  it('un seul badge de gravité et un seul d’état par ligne (pas de badge de retard)', () => {
    expect(html().match(/ui-badge/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    const unePar = renderToStaticMarkup(<ProblemesTableau {...commun} issues={[LISTE[0]]} />);
    expect(unePar.match(/class="ui-badge/g)).toHaveLength(2);
  });

  it('un seul arrêt de tabulation (la première ligne) ; les autres se rejoignent aux flèches', () => {
    const h = html();
    expect(h.match(/tabindex="0"/g)).toHaveLength(1);
    expect(h.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it('la ligne dont le panneau est ouvert est annoncée (aria-current)', () => {
    const h = html({ ouvertId: 'b' });
    expect(h.match(/aria-current="true"/g)).toHaveLength(1);
    expect(h).toMatch(/id="pb-ligne-b"[^>]*aria-current="true"/);
    expect(idLigneProbleme('b')).toBe('pb-ligne-b');
  });

  it('l’agence n’est affichée qu’au CX Manager', () => {
    expect(html()).toContain('Agence Ouaga');
    expect(html({ afficherAgence: false })).not.toContain('Agence Ouaga');
  });

  it('retard : dit en mots, seulement quand l’API le dit (en_retard true) ; jamais « à l’heure »', () => {
    const h = html();
    expect(h.match(/Délai dépassé depuis 3 jours/g)).toHaveLength(1);
    expect(h).not.toMatch(/à l[’']heure|dans les temps|respecté/i);
    expect(html({ issues: [LISTE[1], LISTE[2]] })).not.toContain('Délai dépassé');
  });

  it('avis, actions et échéance : valeurs vraies ou explicitement absentes', () => {
    const h = html();
    expect(h).toContain('2 avis');
    expect(h).toContain('1 à faire sur 2');
    expect(h).toContain('1 à faire sur 1');
    expect(h).toContain('Sans échéance');                                  // une action à faire sans date : dit tel quel
    expect(h).toMatch(/<time dateTime="[^"]+" title="\d{1,2} \S+ 20\d\d[^"]*">\d{1,2} \S+ 20\d\d<\/time>/);
    expect(h).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('cellule d’échéance : date, « Sans échéance », tiret lisible ou rien si l’API ne dit rien', () => {
    const rendre = (i: Issue) => renderToStaticMarkup(<CelluleEcheance issue={i} />);
    expect(rendre(issue('x', { prochaine_echeance: dans(3), nb_actions_a_faire: 1 }))).toContain('<time');
    expect(rendre(issue('x', { nb_actions_a_faire: 2 }))).toContain('Sans échéance');
    expect(rendre(issue('x', { nb_actions_a_faire: 0 }))).toContain('Aucune action à faire');
    expect(rendre({ id: 'x' } as Issue)).toBe('');
  });
});

describe('cartes des problèmes (tablette, mobile)', () => {
  const html = (p: Partial<typeof commun> = {}) => renderToStaticMarkup(<ProblemesCartes {...commun} {...p} />);

  it('un bouton par problème, une ligne d’avancement', () => {
    const h = html();
    expect(h.match(/<button type="button" id="pb-ligne-/g)).toHaveLength(3);
    expect(h).toContain('Délai dépassé depuis 3 jours');
    expect(h).toContain('1 à faire sur 2');
    expect(h).toContain('Aucune action définie');
  });

  it('ouvert : aria-current ; pas de retard inventé ; un badge de gravité et un d’état', () => {
    const h = html({ ouvertId: 'a' });
    expect(h.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html({ issues: [LISTE[1]] })).not.toContain('Délai dépassé');
    expect(renderToStaticMarkup(<ProblemesCartes {...commun} issues={[LISTE[0]]} />).match(/class="ui-badge/g)).toHaveLength(2);
  });
});

describe('filtres : tous côté serveur, vocabulaire des badges', () => {
  const rendre = (f = FILTRES_PAR_DEFAUT) => renderToStaticMarkup(<ProblemesFiltres filtres={f} onChange={() => undefined} />);

  it('état (statuts réels), gravité, « En retard », tri', () => {
    const h = rendre();
    for (const libelle of ['À traiter', 'Rouvert', 'Action en cours', 'Résolu', 'Résolution vérifiée', 'Critique', 'Élevée', 'Normale', 'En retard', 'Plus récents', 'Plus anciens']) {
      expect(h).toContain(libelle);
    }
  });

  it('aucun filtre du passé côté client : plus de « Urgents d’abord » ni de « Problèmes en attente »', () => {
    expect(rendre()).not.toMatch(/Urgents d’abord|Problèmes en attente/);
  });

  it('« En retard » est un bouton à bascule ; « Effacer les filtres » seulement si un filtre est actif', () => {
    expect(rendre()).toContain('aria-pressed="false"');
    expect(rendre()).not.toContain('Effacer les filtres');
    const actif = rendre({ ...FILTRES_PAR_DEFAUT, enRetard: true, statut: 'ouverte' });
    expect(actif).toContain('aria-pressed="true"');
    expect(actif).toContain('Effacer les filtres');
    expect(actif).toMatch(/<option value="ouverte" selected/);
  });
});

describe('pied du détail : « Confirmer la résolution » selon le rôle', () => {
  const resolu = { id: 'i1', statut: 'resolue', actions: [], feedbacks: [] } as unknown as IssueDetail;
  const pied = (role: UserRole | undefined, statut: IssueStatut = 'resolue') => renderToStaticMarkup(<PiedProbleme issue={{ ...resolu, statut }} role={role} onVerifier={() => undefined} />);

  it('CX Manager : le bouton', () => {
    expect(pied('cx_manager')).toContain('Confirmer la résolution');
  });

  it('Agency Manager : aucun bouton, une phrase dit qui confirmera (rien de grisé)', () => {
    const h = pied('agency_manager');
    expect(h).not.toContain('Confirmer la résolution');
    expect(h).not.toContain('disabled');
    expect(h).toContain('Le responsable expérience client confirmera');
  });

  it('administrateur ou rôle inconnu : aucun bouton', () => {
    expect(pied('admin')).not.toContain('Confirmer la résolution');
    expect(pied(undefined)).not.toContain('Confirmer la résolution');
  });

  it('problème qui n’est pas « Résolu » : pas de pied', () => {
    for (const s of ['ouverte', 'action_en_cours', 'reouverte', 'verifiee'] as IssueStatut[]) expect(pied('cx_manager', s)).toBe('');
  });
});

describe('panneau latéral ancré', () => {
  const detail = (extra: Partial<IssueDetail> = {}): IssueDetail => ({
    ...issue('a', { statut: 'resolue' }), agence_nom: 'Agence Ouaga', description: 'Le tiroir-caisse ne s’ouvre plus.', actions: [], feedbacks: [], ...extra,
  } as unknown as IssueDetail);
  const rendre = (role: UserRole, issueDetail: IssueDetail | null, loading = false) => {
    etat.user = { id: 'moi', role, prenom: 'P', nom: 'N' };
    return renderToStaticMarkup(
      <MemoryRouter>
        <PanneauProbleme issue={issueDetail} loading={loading} titreProvisoire="Titre de la ligne" agenceProvisoire="Agence de la ligne" mode="ancre" onClose={() => undefined} onActionsChange={() => undefined} onVerifier={() => undefined} />
      </MemoryRouter>,
    );
  };

  it('région nommée par son titre, bouton de fermeture, focusable', () => {
    const h = rendre('cx_manager', detail());
    expect(h).toContain('<aside');
    expect(h).toContain('role="complementary"');
    expect(h).toContain('aria-labelledby="pb-panneau-titre"');
    expect(h).toContain('Fermer le détail');
    expect(h).toContain('id="pb-panneau-titre"');
  });

  it('chargement : titre et agence de la ligne tout de suite, squelette occupé', () => {
    const h = rendre('cx_manager', null, true);
    expect(h).toContain('Titre de la ligne');
    expect(h).toContain('Agence de la ligne');
    expect(h).toContain('aria-busy="true"');
  });

  it('CX Manager : « Définir une action » et « Confirmer la résolution »', () => {
    const h = rendre('cx_manager', detail({ statut: 'resolue' }));
    expect(h).toContain('Confirmer la résolution');
    const ouvert = rendre('cx_manager', detail({ statut: 'ouverte' }));
    expect(ouvert).toContain('Définir une action');
  });

  it('Agency Manager : ni « Définir une action » ni « Confirmer la résolution », mais l’explication', () => {
    const resolu = rendre('agency_manager', detail({ statut: 'resolue' }));
    expect(resolu).not.toContain('Confirmer la résolution');
    expect(resolu).toContain('Le responsable expérience client confirmera');
    const ouvert = rendre('agency_manager', detail({ statut: 'ouverte' }));
    expect(ouvert).not.toContain('Définir une action');
    expect(ouvert).toContain('Le responsable expérience client décide de l’action.');
  });

  it('actions : responsable_nom fourni par l’API (même pour l’Agency Manager), échéance, état', () => {
    const action = { id: 'x', issue_id: 'a', titre: 'Faire réparer', statut: 'creee', responsable_id: 'u2', responsable_nom: 'Mariam Ouédraogo', echeance: dans(5), created_at: il(1), updated_at: il(1) };
    const h = rendre('agency_manager', detail({ statut: 'action_en_cours', actions: [action as never] }));
    expect(h).toContain('Responsable : Mariam Ouédraogo');
    expect(h).toContain('À faire');
    expect(h).toContain('Échéance <time');
  });

  it('avis liés : trois visibles, les autres repliés', () => {
    const avis = Array.from({ length: 5 }, (_, k) => ({ id: `f${k}`, note: 2, commentaire: `Avis ${k}`, date_soumission: il(k) }));
    const h = rendre('cx_manager', detail({ feedbacks: avis as never }));
    expect(h).toContain('Avis clients liés (5)');
    expect(h).toContain('Voir les 2 autres avis');
    expect(h).toContain('<details');
    const peu = rendre('cx_manager', detail({ feedbacks: avis.slice(0, 3) as never }));
    expect(peu).not.toContain('<details');
  });

  it('origine d’une récidive : dite, avec le lien pour l’ouvrir', () => {
    const h = rendre('cx_manager', detail({ issue_origine_id: 'origine' }));
    expect(h).toContain('Récidive d’un problème précédent');
    expect(rendre('cx_manager', detail())).not.toContain('Récidive');
  });

  it('retard connu : dit en mots dans le détail', () => {
    const h = rendre('cx_manager', detail({ statut: 'ouverte', date_limite_sla: il(4) }));
    expect(h).toContain('Dépassé depuis 4 jours');
  });
});

describe('onglet : états de la liste', () => {
  const props = (surcharge: Record<string, unknown> = {}) => ({
    isAgencyManager: false, agencesList: [], issuesJours: 30, setIssuesJours: () => undefined, issuesAgenceId: null, setIssuesAgenceId: () => undefined,
    filtres: FILTRES_PAR_DEFAUT, setFiltres: () => undefined, issuesKpisRefreshToken: 0, issuesFirstLoadDone: true, issuesListRaw: LISTE, issuesTotal: LISTE.length,
    issuesListError: false, issuesListLoading: false, fetchIssuesList: async () => undefined, openIssueDetail: async () => undefined, issuesLoadingMore: false,
    loadMoreIssues: async () => undefined, selectedIssueId: null, issueDetail: null, issueDetailLoading: false, closeIssueDetail: () => undefined,
    apresActionIssue: async () => undefined, verifierIssue: async () => undefined, ...surcharge,
  });
  const rendre = (surcharge?: Record<string, unknown>) =>
    renderToStaticMarkup(<MemoryRouter><PilotageIssuesTab {...(props(surcharge) as unknown as React.ComponentProps<typeof PilotageIssuesTab>)} /></MemoryRouter>);

  it('chargement : squelette occupé et annoncé', () => {
    const h = rendre({ issuesListLoading: true });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('Chargement des problèmes');
  });

  it('erreur : message qui ne laisse pas croire qu’il n’y a rien, avec « Réessayer »', () => {
    const h = rendre({ issuesListError: true });
    expect(h).toContain('Cela ne signifie pas qu’il n’y en a pas');
    expect(h).toContain('Réessayer');
    expect(h).not.toContain('Aucun problème');
  });

  it('vide sans filtre : message honnête, pas de filtres', () => {
    const h = rendre({ issuesListRaw: [], issuesTotal: 0 });
    expect(h).toContain('Aucun problème suivi');
    expect(h).not.toContain('Filtres des problèmes');
  });

  it('vide avec filtres : le dit, avec « Effacer les filtres »', () => {
    const h = rendre({ issuesListRaw: [], issuesTotal: 0, filtres: { ...FILTRES_PAR_DEFAUT, enRetard: true } });
    expect(h).toContain('Aucun problème pour ces filtres');
    expect(h).toContain('Effacer les filtres');
  });

  it('partiel : « 3 chargés sur 120 » vrai et « Charger plus »', () => {
    const h = rendre({ issuesTotal: 120 });
    expect(h).toContain('3 problèmes chargés sur 120');
    expect(h).toContain('Charger plus (3/120)');
    expect(h).toContain('Problèmes à traiter (120)');
  });

  it('complet : pas de « Charger plus » ; le nombre est celui du serveur', () => {
    const h = rendre();
    expect(h).not.toContain('Charger plus');
    expect(h).toContain('Problèmes à traiter (3)');
  });

  it('le CX voit le filtre d’agence, l’Agency Manager non', () => {
    expect(rendre({ agencesList: [{ id: 'ag1', nom: 'Ouaga' }] })).toContain('Ouaga');
    expect(rendre({ isAgencyManager: true })).not.toContain('Agence Ouaga');
  });

  it('la liste passe avant les indicateurs', () => {
    const h = rendre();
    expect(h.indexOf('id="issues-liste"')).toBeLessThan(Math.max(h.indexOf('kpi-bandeau'), h.indexOf('Chargement des indicateurs')));
  });
});

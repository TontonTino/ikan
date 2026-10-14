import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HistoriqueSuggestion, Suggestion } from '../../types';
import SuggestionCarte, { DernierChangement, FormulaireChangement, HistoriqueListe } from './SuggestionCarte';
import PilotageIdeasTab from './PilotageIdeasTab';
import { suggestionsReducer, SUGGESTIONS_INITIAL } from './suggestionsState';
import {
  CHANGEMENT_FERME, LONGUEUR_MAX_COMMENTAIRE, actionsPossibles, changementReducer, commentaireAEnvoyer, compteurCommentaire,
  libelleDernierChangement, libelleTransition, messageErreurChangement,
} from './suggestionsHistorique';

const entree = (surcharge: Partial<HistoriqueSuggestion> = {}): HistoriqueSuggestion => ({
  id: 'h1', ancien_statut: 'en_cours', nouveau_statut: 'traite', date: '2026-10-13T09:30:00Z', auteur_nom: 'Awa Traoré',
  auteur_role: 'agency_manager', commentaire: null, ...surcharge,
});
const idee = (surcharge: Partial<Suggestion> = {}): Suggestion =>
  ({ id: 's1', feedback_id: null, contenu: 'Ouvrir le samedi', statut: 'nouveau', date_soumission: '2026-10-10T10:00:00Z', ...surcharge } as Suggestion);

const carte = (s: Suggestion, avecHistorique = true) =>
  renderToStaticMarkup(<SuggestionCarte suggestion={s} updateStatut={vi.fn()} chargerHistorique={avecHistorique ? vi.fn() : undefined} />);

describe('dernier changement affiché sur la carte', () => {
  it('« Traité par <nom>, le <date> »', () => {
    expect(libelleDernierChangement(entree())).toBe('Traité par Awa Traoré, le 13 octobre 2026');
    const html = carte(idee({ statut: 'traite', dernier_changement: entree() }));
    expect(html).toContain('Traité par Awa Traoré, le 13 octobre 2026');
  });

  it('avec son commentaire', () => {
    const html = renderToStaticMarkup(<DernierChangement entree={entree({ commentaire: 'mis en place lundi' })} />);
    expect(html).toContain('« mis en place lundi »');
  });

  it('jamais modifiée : rien (pas de faux « par … »)', () => {
    expect(renderToStaticMarkup(<DernierChangement entree={null} />)).toBe('');
    expect(carte(idee({ dernier_changement: null }))).not.toMatch(/ par |Dernier/);
  });

  it('auteur supprimé depuis : « auteur inconnu », jamais « null »', () => {
    expect(libelleDernierChangement(entree({ auteur_nom: null }))).toContain('par auteur inconnu');
    expect(renderToStaticMarkup(<DernierChangement entree={entree({ auteur_nom: null })} />)).not.toContain('null');
  });
});

describe('historique complet', () => {
  it('liste chronologique lisible : transition, date, auteur et rôle en texte, commentaire', () => {
    const html = renderToStaticMarkup(
      <HistoriqueListe etat={{ statut: 'pret', entrees: [
        entree({ id: 'a', ancien_statut: 'nouveau', nouveau_statut: 'en_cours', commentaire: 'à étudier', date: '2026-10-11T08:00:00Z' }),
        entree({ id: 'b' }),
      ] }} />,
    );
    expect(html).toContain('<ol');
    expect(html).toContain('aria-label="Historique des changements de statut"');
    expect(html.indexOf('Nouveau → En cours')).toBeLessThan(html.indexOf('En cours → Traité'));   // ordre chronologique conservé
    expect(html).toContain('par Awa Traoré (Responsable d’agence)');
    expect(html).toContain('« à étudier »');
    expect(html).toContain('<time');
  });

  it('historique vide : message dédié, pas une liste vide muette', () => {
    const html = renderToStaticMarkup(<HistoriqueListe etat={{ statut: 'pret', entrees: [] }} />);
    expect(html).toContain('Aucun changement de statut pour le moment.');
    expect(html).not.toContain('<ol');
  });

  it('chargement et erreur : jamais confondus avec un historique vide', () => {
    expect(renderToStaticMarkup(<HistoriqueListe etat={{ statut: 'chargement', entrees: [] }} />)).toContain('aria-busy="true"');
    const erreur = renderToStaticMarkup(<HistoriqueListe etat={{ statut: 'erreur', entrees: [] }} onRetry={vi.fn()} />);
    expect(erreur).toContain('Impossible de charger l’historique');
    expect(erreur).toContain('Réessayer');
    expect(erreur).not.toContain('Aucun changement');
  });

  it('la carte propose « Voir l’historique » (bouton natif, état annoncé) seulement si le chargement est branché', () => {
    const avec = carte(idee());
    expect(avec).toContain('Voir l’historique');
    expect(avec).toContain('aria-expanded="false"');
    expect(carte(idee(), false)).not.toContain('Voir l’historique');
  });

  it('libellés de transition en texte', () => {
    expect(libelleTransition(entree({ ancien_statut: 'nouveau', nouveau_statut: 'rejete' }))).toBe('Nouveau → Rejeté');
    expect(libelleTransition(entree({ ancien_statut: null }))).toBe('Création → Traité');
  });
});

describe('commentaire du changement de statut', () => {
  const ouvert = changementReducer(CHANGEMENT_FERME, { type: 'ouvrir', cible: 'traite' });

  it('champ facultatif avec libellé, compteur et limite', () => {
    const html = renderToStaticMarkup(<FormulaireChangement etat={{ ...ouvert, commentaire: 'bonjour' }} onCommentaire={vi.fn()} onConfirmer={vi.fn()} onAnnuler={vi.fn()} />);
    expect(html).toContain('commentaire (facultatif)');
    expect(html).toContain('7 / 500 caractères');
    expect(html).toContain(`maxLength="${LONGUEUR_MAX_COMMENTAIRE}"`);
    expect(html).toContain('Annuler');
    expect(html).toContain('Confirmer');
    expect(compteurCommentaire('x'.repeat(500))).toBe('500 / 500');
  });

  it('la saisie est bornée à 500 caractères et un commentaire vide n’est pas envoyé', () => {
    const etat = changementReducer(ouvert, { type: 'saisir', commentaire: 'x'.repeat(800) });
    expect(etat.commentaire).toHaveLength(LONGUEUR_MAX_COMMENTAIRE);
    expect(commentaireAEnvoyer('   ')).toBeUndefined();
    expect(commentaireAEnvoyer('  ok  ')).toBe('ok');
  });

  it('formulaire fermé : rien n’est affiché', () => {
    expect(renderToStaticMarkup(<FormulaireChangement etat={CHANGEMENT_FERME} onCommentaire={vi.fn()} onConfirmer={vi.fn()} onAnnuler={vi.fn()} />)).toBe('');
  });
});

describe('refus de l’API (409) : message clair, saisie conservée', () => {
  it('le message du serveur est affiché tel quel pour un 409', () => {
    const message = 'Une suggestion ne peut pas revenir au statut « Nouveau ». Pour la rouvrir, choisissez « En cours ».';
    expect(messageErreurChangement({ response: { status: 409, data: { detail: message } } })).toBe(message);
  });

  it('autres cas : message utile, jamais de détail technique', () => {
    expect(messageErreurChangement({ response: { status: 422 } })).toContain('500 caractères');
    expect(messageErreurChangement({ response: { status: 403 } })).toContain('accès');
    expect(messageErreurChangement({ response: { status: 404 } })).toContain('n’existe plus');
    for (const brut of [new Error('Network Error'), undefined, { response: { status: 500, data: { detail: 'boom SQL' } } }]) {
      const m = messageErreurChangement(brut);
      expect(m).toBe('Impossible d’enregistrer la modification. Réessayez.');
      expect(m).not.toMatch(/boom|Network|SQL/);
    }
  });

  it('un échec garde le formulaire ouvert ET le commentaire ; un succès le referme', () => {
    let etat = changementReducer(CHANGEMENT_FERME, { type: 'ouvrir', cible: 'en_cours' });
    etat = changementReducer(etat, { type: 'saisir', commentaire: 'ma justification détaillée' });
    etat = changementReducer(etat, { type: 'envoyer' });
    expect(etat.envoi).toBe(true);
    etat = changementReducer(etat, { type: 'echec', message: 'Une suggestion ne peut pas revenir au statut « Nouveau ».' });
    expect(etat).toMatchObject({ cible: 'en_cours', commentaire: 'ma justification détaillée', envoi: false, erreur: 'Une suggestion ne peut pas revenir au statut « Nouveau ».' });
    const html = renderToStaticMarkup(<FormulaireChangement etat={etat} onCommentaire={vi.fn()} onConfirmer={vi.fn()} onAnnuler={vi.fn()} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('ne peut pas revenir au statut');
    expect(html).toContain('ma justification détaillée');
    expect(changementReducer(etat, { type: 'saisir', commentaire: 'corrigé' }).erreur).toBeNull();   // l'erreur disparaît dès qu'on corrige
    expect(changementReducer(etat, { type: 'succes' })).toEqual(CHANGEMENT_FERME);
    expect(changementReducer(etat, { type: 'annuler' })).toEqual(CHANGEMENT_FERME);
  });

  it('rouvrir une autre cible repart d’un commentaire vide, la même cible le conserve', () => {
    const a = changementReducer(changementReducer(CHANGEMENT_FERME, { type: 'ouvrir', cible: 'traite' }), { type: 'saisir', commentaire: 'x' });
    expect(changementReducer(a, { type: 'ouvrir', cible: 'rejete' }).commentaire).toBe('');
    expect(changementReducer(a, { type: 'ouvrir', cible: 'traite' }).commentaire).toBe('x');
  });
});

describe('actions proposées et accessibilité', () => {
  it('les statuts traité et rejeté peuvent être rouverts (En cours), jamais proposés vers « Nouveau »', () => {
    expect(actionsPossibles('traite').map((a) => a.libelle)).toContain('Rouvrir (En cours)');
    expect(actionsPossibles('rejete').map((a) => a.cible)).toEqual(['en_cours']);
    for (const statut of ['nouveau', 'en_cours', 'traite', 'rejete'] as const) {
      expect(actionsPossibles(statut).map((a) => a.cible)).not.toContain('nouveau');
    }
  });

  it('boutons natifs de 44 px minimum, libellés en texte', () => {
    const html = carte(idee({ statut: 'traite' }));
    expect(html).toContain('Rouvrir (En cours)');
    expect(html).toContain('Rejeter');
    expect((html.match(/min-height:44px/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(html).not.toMatch(/<div[^>]*role="button"/);
  });

  it('dans la liste : la carte reçoit le dernier changement', () => {
    const html = renderToStaticMarkup(
      <PilotageIdeasTab suggestions={[idee({ statut: 'traite', dernier_changement: entree() })]} suggestionsTotal={1} suggestionsLoading={false} suggestionsLoadingMore={false}
        suggestionsError={false} onRetrySuggestions={vi.fn()} loadMoreSuggestions={vi.fn()} updateStatut={vi.fn()} chargerHistorique={vi.fn()}
        activeSubTab="toutes" setActiveSubTab={vi.fn()} />,
    );
    expect(html).toContain('Traité par Awa Traoré, le 13 octobre 2026');
    expect(html).toContain('Voir l’historique');
  });
});

describe('état de la liste après un changement', () => {
  it('« maj » remplace la suggestion par la version du serveur (dernier changement compris)', () => {
    const avant = { ...SUGGESTIONS_INITIAL, statut: 'pret' as const, donnees: [idee(), idee({ id: 's2' })], total: 2 };
    const apres = suggestionsReducer(avant, { type: 'maj', suggestion: idee({ statut: 'traite', dernier_changement: entree() }) });
    expect(apres.donnees[0].statut).toBe('traite');
    expect(apres.donnees[0].dernier_changement?.auteur_nom).toBe('Awa Traoré');
    expect(apres.donnees[1].statut).toBe('nouveau');
    expect(apres.donnees[0].contenu).toBe('Ouvrir le samedi');
  });
});

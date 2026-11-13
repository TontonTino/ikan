import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { EvenementProbleme, IssueDetail } from '../../types';

const etat = vi.hoisted(() => ({ user: { id: 'moi', role: 'cx_manager', prenom: 'Awa', nom: 'Sawadogo' } as unknown }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));

import { FilActiviteListe, type EtatFil } from './FilActivite';
import PanneauProbleme from './PanneauProbleme';

const MAINTENANT = new Date('2026-11-04T12:00:00Z');
const JOUR = 86_400_000;
const il = (j: number) => new Date(MAINTENANT.getTime() - j * JOUR).toISOString();

const e = (id: string, type: string, extra: Partial<EvenementProbleme> = {}): EvenementProbleme =>
  ({ id, type_evenement: type, date_evenement: il(1), auteur_nom: 'Awa Sawadogo', auteur_role: 'cx_manager', ancien_statut: null, nouveau_statut: null, details: null, ...extra });

const ok = (evenements: EvenementProbleme[], total = evenements.length, extra: Record<string, unknown> = {}): EtatFil =>
  ({ statut: 'ok', evenements, total, chargementSuite: false, erreurSuite: false, ...extra }) as EtatFil;
const rendre = (etatFil: EtatFil, ajoutes = 0) => renderToStaticMarkup(<FilActiviteListe etat={etatFil} voirPlus={() => undefined} reessayer={() => undefined} ajoutes={ajoutes} maintenant={MAINTENANT} />);

describe('fil d’activité : états', () => {
  it('chargement : squelette occupé et annoncé', () => {
    const h = rendre({ statut: 'chargement' });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('Chargement de l’activité');
  });

  it('erreur : jamais « aucun événement », avec « Réessayer »', () => {
    const h = rendre({ statut: 'erreur' });
    expect(h).toContain('Cela ne signifie pas qu’il n’y en a pas');
    expect(h).toContain('Réessayer');
    expect(h).not.toContain('Aucun événement');
  });

  it('vide : le dit tel quel', () => {
    expect(rendre(ok([]))).toContain('Aucun événement enregistré pour ce problème.');
  });

  it('erreur lors de « Voir plus » : le fil déjà chargé reste, avec « Réessayer »', () => {
    const h = rendre(ok([e('1', 'creation')], 25, { erreurSuite: true }));
    expect(h).toContain('Problème enregistré');
    expect(h).toContain('Impossible de charger la suite de l’activité.');
    expect(h).toContain('Réessayer');
    expect(h).not.toContain('Voir plus');
  });
});

describe('fil d’activité : contenu', () => {
  const fil = [
    e('1', 'issue_verifiee', { date_evenement: il(0.1) }),
    e('2', 'action_terminee', { details: 'Réparer la climatisation', date_evenement: il(3), auteur_nom: 'Issouf Traoré', auteur_role: 'agency_manager' }),
    e('3', 'creation', { date_evenement: il(45), auteur_nom: null, auteur_role: null }),
  ];

  it('liste ordonnée nommée, une entrée par événement, dans l’ordre reçu (le serveur trie)', () => {
    const h = rendre(ok(fil));
    expect(h).toContain('<ol');
    expect(h).toContain('aria-label="Activité du problème, du plus récent au plus ancien"');
    expect(h.match(/<li /g)).toHaveLength(3);
    expect(h.indexOf('Résolution confirmée')).toBeLessThan(h.indexOf('Action terminée'));
    expect(h.indexOf('Action terminée')).toBeLessThan(h.indexOf('Problème enregistré'));
  });

  it('auteur par son nom ; « Système » seulement quand la base n’en dit rien ; rôle au survol', () => {
    const h = rendre(ok(fil));
    expect(h).toContain('Awa Sawadogo');
    expect(h).toContain('Issouf Traoré');
    expect(h).toContain('title="Responsable d’agence"');
    expect(h).toContain('>Système<');
    expect(h.match(/>Système</g)).toHaveLength(1);
  });

  it('titre d’action entre guillemets', () => {
    expect(rendre(ok(fil))).toContain('Action terminée : « Réparer la climatisation »');
  });

  it('dates : relative puis absolue (au-delà de 30 jours), dans <time>, date complète au survol, jamais jj/mm/aaaa', () => {
    const h = rendre(ok(fil));
    expect(h).toMatch(/<time dateTime="[^"]+" title="\d{1,2} \S+ 2026 à \d{2}:\d{2}">il y a 3 heures?<\/time>|<time dateTime="[^"]+" title="[^"]+">il y a 2 heures<\/time>/);
    expect(h).toMatch(/<time dateTime="[^"]+" title="[^"]+">il y a 3 jours<\/time>/);
    expect(h).toMatch(/<time dateTime="[^"]+" title="[^"]+">\d{1,2} \S+ 2026<\/time>/);                 // 45 jours : date absolue
    expect(h).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('aucun élément focusable dans la liste (pas de faux lien) ; seul « Voir plus » est un bouton', () => {
    const h = rendre(ok(fil));
    expect(h).not.toContain('<button');
    expect(h).not.toContain('<a ');
    expect(h).not.toContain('tabindex');
  });

  it('un type inconnu n’affiche jamais son nom technique', () => {
    const h = rendre(ok([e('9', 'evenement_technique_x', { details: 'texte libre secret' })]));
    expect(h).toContain('Autre événement');
    expect(h).not.toContain('evenement_technique_x');
    expect(h).not.toContain('texte libre secret');
  });

  it('« Voir plus (n) » seulement s’il en reste, avec le vrai reste', () => {
    expect(rendre(ok(fil, 13))).toContain('Voir plus (10)');
    expect(rendre(ok(fil, 3))).not.toContain('Voir plus');
    expect(rendre(ok(fil, 13, { chargementSuite: true }))).toContain('Chargement…');
  });

  it('après « Voir plus » : l’ajout est annoncé et le premier événement ajouté peut recevoir le focus', () => {
    const h = rendre(ok([...fil, e('4', 'feedback_rattache'), e('5', 'feedback_rattache')], 5), 2);
    expect(h).toContain('2 événements de plus affichés.');
    expect(h.match(/tabindex="-1"/g)).toHaveLength(1);
  });
});

describe('panneau : section « Activité »', () => {
  it('le panneau d’un problème contient « Activité » (chargement tant que le fil n’est pas arrivé)', () => {
    etat.user = { id: 'moi', role: 'cx_manager', prenom: 'P', nom: 'N' };
    const issue = { id: 'i1', titre: 'Climatisation', statut: 'ouverte', severite: 'elevee', agence_id: 'ag1', agence_nom: 'Agence', actions: [], feedbacks: [], updated_at: il(1), premiere_detection: il(2) } as unknown as IssueDetail;
    const h = renderToStaticMarkup(
      <MemoryRouter><PanneauProbleme issue={issue} loading={false} mode="ancre" onClose={() => undefined} onActionsChange={() => undefined} onVerifier={() => undefined} /></MemoryRouter>,
    );
    expect(h).toContain('Activité');
    expect(h).toContain('Chargement de l’activité');
    expect(h.indexOf('Activité')).toBeLessThan(h.indexOf('Escalades'));
  });
});

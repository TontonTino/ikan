import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { IssueDetail, UserRole } from '../../types';

import DelaiRecurrence, { EditeurDelai, EditeurOrigine, type EtatCandidats } from './DelaiRecurrence';
import PanneauProbleme from './PanneauProbleme';
import { vi } from 'vitest';

const etat = vi.hoisted(() => ({ user: { id: 'moi', role: 'cx_manager', prenom: 'Awa', nom: 'Sawadogo' } as unknown }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));

const MAINTENANT = Date.now();
const JOUR = 86_400_000;
const il = (j: number) => new Date(MAINTENANT - j * JOUR).toISOString();
const dans = (j: number) => new Date(MAINTENANT + j * JOUR).toISOString();

const detail = (extra: Partial<IssueDetail> = {}): IssueDetail =>
  ({ id: 'i1', titre: 'Climatisation', statut: 'ouverte', severite: 'elevee', agence_id: 'ag1', agence_nom: 'Agence', actions: [], feedbacks: [], premiere_detection: il(10), updated_at: il(1), ...extra }) as unknown as IssueDetail;

const rendre = (role: UserRole, issue: IssueDetail) =>
  renderToStaticMarkup(<MemoryRouter><DelaiRecurrence issue={issue} role={role} onChange={() => undefined} onOuvrirOrigine={() => undefined} maintenant={MAINTENANT} /></MemoryRouter>);

describe('rôles : qui voit des commandes', () => {
  it('CX Manager : fixer un délai, lier un problème d’origine ; pas de phrase « c’est le CX qui décide »', () => {
    const h = rendre('cx_manager', detail());
    expect(h).toContain('Délai et récurrence');
    expect(h).toContain('Fixer un délai');
    expect(h).toContain('Lier un problème d’origine');
    expect(h).not.toContain('sont fixés par le responsable expérience client');
  });

  it('Agency Manager : valeurs lisibles, AUCUN bouton ni champ de saisie, la phrase dit qui décide', () => {
    const h = rendre('agency_manager', detail({ date_limite_sla: dans(4), issue_origine_id: 'origine' }));
    expect(h).toContain('À traiter avant le');
    expect(h).toContain('Récidive d’un problème précédent');
    expect(h).toContain('Le délai de traitement et la récurrence sont fixés par le responsable expérience client.');
    for (const interdit of ['Fixer un délai', 'Modifier le délai', 'Effacer le délai', 'Changer l’origine', 'Retirer le lien', 'Lier un problème', '<input', '<select', '<form']) expect(h).not.toContain(interdit);
    // seul « Voir ce problème » (lecture) est un bouton
    expect(h.match(/<button/g)).toHaveLength(1);
  });

  it('administrateur et rôle inconnu : pas de commande', () => {
    for (const role of ['admin', undefined] as unknown as UserRole[]) expect(rendre(role, detail())).not.toContain('Fixer un délai');
  });
});

describe('ce qui est dit, et seulement ce qui est vrai', () => {
  it('sans délai : « Aucun délai fixé », jamais « à l’heure » ni « dans les temps »', () => {
    for (const role of ['cx_manager', 'agency_manager'] as const) {
      const h = rendre(role, detail());
      expect(h).toContain('Aucun délai fixé');
      expect(h).not.toMatch(/à l’heure|dans les temps|en retard|Dépassé/i);
    }
  });

  it('sans origine : aucune récidive affichée', () => {
    const h = rendre('cx_manager', detail());
    expect(h).toContain('Aucun problème d’origine lié');
    expect(h).not.toContain('Récidive');
  });

  it('délai à venir : date dans <time> avec la date complète au survol ; délai dépassé : dit en jours', () => {
    expect(rendre('cx_manager', detail({ date_limite_sla: dans(4) }))).toMatch(/À traiter avant le <time dateTime="[^"]+" title="[^"]+">\d{1,2} \S+ \d{4}<\/time>/);
    expect(rendre('cx_manager', detail({ date_limite_sla: il(4) }))).toContain('Dépassé depuis 4 jours');
  });

  it('délai déjà posé : « Modifier » et « Effacer » ; origine posée : « Changer » et « Retirer »', () => {
    const h = rendre('cx_manager', detail({ date_limite_sla: dans(4), issue_origine_id: 'o' }));
    for (const t of ['Modifier le délai', 'Effacer le délai', 'Changer l’origine', 'Retirer le lien']) expect(h).toContain(t);
  });

  it('problème résolu ou vérifié : le délai ne se modifie plus (dit pourquoi), la récurrence reste modifiable', () => {
    for (const statut of ['resolue', 'verifiee'] as const) {
      const h = rendre('cx_manager', detail({ statut, date_limite_sla: dans(4) }));
      expect(h).toContain('Le problème est résolu : son délai ne peut plus être modifié.');
      expect(h).not.toContain('Modifier le délai');
      expect(h).not.toContain('Effacer le délai');
      expect(h).toContain('Lier un problème d’origine');
      expect(h).toMatch(/Fixé au <time/);
    }
  });
});

describe('éditeur du délai', () => {
  const rendreEditeur = (extra: Partial<React.ComponentProps<typeof EditeurDelai>> = {}) =>
    renderToStaticMarkup(<EditeurDelai id="d" jour="" min="2026-11-01" erreur={null} envoi={false} onChange={() => undefined} onSoumettre={() => undefined} onAnnuler={() => undefined} {...extra} />);

  it('champ date nommé, requis, avec aide ; focus à l’ouverture', () => {
    const h = rendreEditeur();
    expect(h).toContain('<label for="d"');
    expect(h).toContain('type="date"');
    expect(h).toContain('min="2026-11-01"');
    expect(h).toContain('aria-required="true"');
    expect(h).toContain('data-autofocus');
    expect(h).toContain('Enregistrer le délai');
    expect(h).toContain('Annuler');
  });

  it('erreur : liée au champ, annoncée, saisie conservée', () => {
    const h = rendreEditeur({ jour: '2026-10-01', erreur: 'Le délai doit être postérieur' });
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('aria-describedby="d-aide d-erreur"');
    expect(h).toContain('role="alert"');
    expect(h).toContain('value="2026-10-01"');
  });

  it('pendant l’envoi : champ en lecture seule, bouton en chargement, « Annuler » désactivé', () => {
    const h = rendreEditeur({ jour: '2026-11-12', envoi: true });
    expect(h).toContain('readonly=""');
    expect(h).toContain('Enregistrement…');
    expect(h).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Annuler/);
  });
});

describe('éditeur de la récurrence', () => {
  const ok = (liste: unknown[], total = liste.length): EtatCandidats => ({ statut: 'ok', liste: liste as never, total, charges: liste.length });
  const p = (id: string, titre: string) => ({ id, titre, statut: 'resolue', premiere_detection: il(20), issue_origine_id: null, agence_nom: 'Agence Ouaga' }) as never;
  const rendreEditeur = (candidats: EtatCandidats, propositions: unknown[] = [], extra: Partial<React.ComponentProps<typeof EditeurOrigine>> = {}) =>
    renderToStaticMarkup(<EditeurOrigine id="o" candidats={candidats} propositions={propositions as never} choix="" erreur={null} envoi={false} onChange={() => undefined} onSoumettre={() => undefined} onAnnuler={() => undefined} onRecharger={() => undefined} {...extra} />);

  it('chargement : occupé et annoncé, pas de liste', () => {
    const h = rendreEditeur({ statut: 'chargement' });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('Chargement des problèmes');
    expect(h).not.toContain('<select');
  });

  it('erreur de chargement : dit que la liste manque, avec « Réessayer »', () => {
    const h = rendreEditeur({ statut: 'erreur' });
    expect(h).toContain('La liste des problèmes n’a pas pu être chargée.');
    expect(h).toContain('Réessayer');
    expect(h).not.toContain('<select');
  });

  it('aucun problème proposable : le dit, sans champ', () => {
    const h = rendreEditeur(ok([]));
    expect(h).toContain('Aucun problème résolu ou vérifié');
    expect(h).not.toContain('<select');
  });

  it('propositions : titre et agence, jamais d’identifiant visible', () => {
    const h = rendreEditeur(ok([p('uuid-secret-1', 'Climatisation')]), [p('uuid-secret-1', 'Climatisation')]);
    expect(h).toContain('<select');
    expect(h).toContain('Climatisation · Agence Ouaga');
    expect(h).toContain('Choisir un problème');
    expect(h).toContain('aria-required="true"');
    expect(h).not.toContain('>uuid-secret-1<');
  });

  it('liste tronquée : le dit avec le vrai total', () => {
    expect(rendreEditeur({ statut: 'ok', liste: [], total: 340, charges: 200 }, [p('a', 'A')])).toContain('(sur 340)');
  });

  it('erreur de choix : liée au champ et annoncée', () => {
    const h = rendreEditeur(ok([p('a', 'A')]), [p('a', 'A')], { erreur: 'Choisissez un problème d’origine, ou annulez.' });
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('role="alert"');
  });
});

describe('panneau : la section est présente pour les deux rôles', () => {
  const panneau = (role: UserRole) => {
    etat.user = { id: 'moi', role, prenom: 'P', nom: 'N' };
    return renderToStaticMarkup(
      <MemoryRouter><PanneauProbleme issue={detail({ date_limite_sla: dans(3) })} loading={false} mode="ancre" onClose={() => undefined} onActionsChange={() => undefined} onVerifier={() => undefined} /></MemoryRouter>,
    );
  };
  it('CX : commandes ; Agency Manager : lecture et phrase', () => {
    expect(panneau('cx_manager')).toContain('Modifier le délai');
    const am = panneau('agency_manager');
    expect(am).toContain('Délai et récurrence');
    expect(am).toContain('sont fixés par le responsable expérience client');
    expect(am).not.toContain('Modifier le délai');
  });
  it('le délai n’est plus répété dans « Situation »', () => {
    expect(panneau('cx_manager').match(/À traiter avant le/g)).toHaveLength(1);
  });
});

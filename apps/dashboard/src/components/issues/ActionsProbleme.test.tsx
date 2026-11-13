import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
// @ts-ignore — pas de types Node dans ce projet ; le test lit les sources (comme styles/contraste.test.ts).
import { readdirSync, readFileSync } from 'node:fs';
import type { ActionCorrective, IssueDetail, IssueStatut, UserRole } from '../../types';
import ActionsDuProbleme from './ActionsDuProbleme';
import { CorpsDefinirAction, PiedDefinirAction, type IdsChamps } from './DefinirActionDialog';
import { CorpsTerminerAction, PiedTerminerAction, TEXTE_CONFIRMATION_TERMINER } from './TerminerActionDialog';
import { MESSAGES_DEFINIR, SAISIE_VIDE, personnesAssignables, type UtilisateurListe } from '../../utils/actionsProbleme';

const action = (id: string, extra: Partial<ActionCorrective> = {}): ActionCorrective =>
  ({ id, issue_id: 'i1', titre: `Action ${id}`, statut: 'creee', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', ...extra } as ActionCorrective);

const probleme = (statut: IssueStatut, actions: ActionCorrective[]): IssueDetail =>
  ({ id: 'i1', agence_id: 'ag1', agence_nom: 'Agence 1', titre: 'Climatisation', statut, severite: 'critique', actions, feedbacks: [] } as unknown as IssueDetail);

const rendre = (role: UserRole | undefined, issue: IssueDetail, utilisateurs: UtilisateurListe[] = [], moiId = 'moi', nouvelle: string | null = null) =>
  renderToStaticMarkup(<ActionsDuProbleme issue={issue} role={role} utilisateurs={utilisateurs} moiId={moiId} nouvelleActionId={nouvelle} onDefinir={() => undefined} onTerminer={() => undefined} />);

describe('« Définir une action » : visible selon le rôle, jamais grisé', () => {
  it('CX Manager : le bouton existe sur un problème à traiter, sans action comme avec actions', () => {
    for (const statut of ['ouverte', 'reouverte', 'action_en_cours'] as IssueStatut[]) {
      expect(rendre('cx_manager', probleme(statut, []))).toContain('Définir une action');
      expect(rendre('cx_manager', probleme(statut, [action('a')]))).toContain('Définir une action');
    }
  });

  it('CX Manager : pas de bouton sur un problème résolu ou vérifié', () => {
    expect(rendre('cx_manager', probleme('resolue', [action('a', { statut: 'terminee' })]))).not.toContain('Définir une action');
    expect(rendre('cx_manager', probleme('verifiee', []))).not.toContain('Définir une action');
  });

  it('Agency Manager, administrateur, rôle inconnu : aucun bouton (et aucun bouton désactivé)', () => {
    for (const role of ['agency_manager', 'admin', undefined] as Array<UserRole | undefined>) {
      const html = rendre(role, probleme('ouverte', []));
      expect(html).not.toContain('Définir une action');
      expect(html).not.toContain('disabled');
    }
  });

  it('Agency Manager, problème sans action : un texte dit qui décide', () => {
    expect(rendre('agency_manager', probleme('ouverte', []))).toContain('Le responsable expérience client décide de l’action.');
    expect(rendre('cx_manager', probleme('ouverte', []))).toContain('Décidez de la première action pour régler ce problème');
    expect(rendre('agency_manager', probleme('verifiee', []))).toContain('Aucune action n’a été définie pour ce problème.');
  });
});

describe('états du bloc « Actions à mener »', () => {
  it('une action : état, responsable, échéance (dans <time>), bouton Terminer', () => {
    const html = rendre('cx_manager', probleme('action_en_cours', [action('a', { responsable_id: 'moi', echeance: '2026-11-20T12:00:00Z' })]));
    expect(html).toContain('Actions (1)');
    expect(html).toContain('À faire');
    expect(html).toContain('Responsable : Vous');
    expect(html).toMatch(/Échéance <time dateTime="2026-11-20T12:00:00Z" title="20 novembre 2026[^"]*">20 nov\. 2026<\/time>/);
    expect(html).toContain('Terminer');
  });

  it('sans échéance et sans responsable : dit explicitement « Sans échéance » / « Sans responsable »', () => {
    const html = rendre('cx_manager', probleme('action_en_cours', [action('a')]));
    expect(html).toContain('Sans échéance');
    expect(html).toContain('Responsable : Sans responsable');
  });

  it('plusieurs actions dont une terminée : un seul « Terminer », badge « Terminée » sans bouton', () => {
    const html = rendre('cx_manager', probleme('action_en_cours', [action('a'), action('b', { statut: 'terminee', date_completion: '2026-11-02T10:00:00Z' })]));
    expect(html).toContain('Actions (2)');
    expect(html.match(/>Terminer</g)).toHaveLength(1);
    expect(html).toContain('Terminée');
    expect(html).toContain('Terminée le <time');
  });

  it('Agency Manager : ne termine que SES actions, ne voit pas « Définir une action » ; le nom du responsable n’est jamais inventé', () => {
    const html = rendre('agency_manager', probleme('action_en_cours', [action('a', { responsable_id: 'autre' }), action('b', { responsable_id: 'am' })]), [], 'am');
    expect(html.match(/>Terminer</g)).toHaveLength(1);                       // l'action dont il est responsable, pas celle d'un autre
    expect(html).not.toContain('Définir une action');
    expect(html).toContain('Responsable : Assigné');
    expect(html).toContain('Responsable : Vous');
    const autre = rendre('agency_manager', probleme('action_en_cours', [action('a', { responsable_id: 'autre' })]), [], 'am');
    expect(autre).not.toContain('>Terminer<');
  });

  it('le CX Manager voit le nom d’un responsable connu', () => {
    const am: UtilisateurListe = { id: 'am1', prenom: 'Issa', nom: 'Bado', role: 'agency_manager', agence_id: 'ag1', active: true };
    expect(rendre('cx_manager', probleme('action_en_cours', [action('a', { responsable_id: 'am1' })]), [am])).toContain('Responsable : Issa Bado');
  });

  it('action terminée seule : aucun bouton Terminer, pour aucun rôle', () => {
    const html = rendre('cx_manager', probleme('resolue', [action('a', { statut: 'terminee' })]));
    expect(html).not.toContain('>Terminer<');
  });

  it('nouvelle action : repère visuel et annonce vocale', () => {
    const html = rendre('cx_manager', probleme('action_en_cours', [action('a')]), [], 'moi', 'a');
    expect(html).toContain('action-probleme is-nouvelle');
    expect(html).toContain('Action ajoutée.');
  });
});

describe('boîte « Définir une action »', () => {
  const ids: IdsChamps = { formulaire: 'f', titre: 't', description: 'd', compteur: 'c', responsable: 'r', echeance: 'e' };
  const moi = { id: 'moi', prenom: 'Awa', nom: 'Traoré' };
  const liste: UtilisateurListe[] = [
    { id: 'a1', prenom: 'Issa', nom: 'Bado', role: 'agency_manager', agence_id: 'ag1', active: true },
    { id: 'b1', prenom: 'Zoé', nom: 'Autre', role: 'agency_manager', agence_id: 'ag2', active: true },
  ];
  const personnes = personnesAssignables(liste, 'ag1', moi);
  const base = {
    saisie: SAISIE_VIDE, onChange: () => undefined, erreurs: {}, envoi: false, echec: null, onReessayer: () => undefined, onSoumettre: () => undefined,
    personnes, responsables: { statut: 'ok' as const, utilisateurs: liste }, onRechargerResponsables: () => undefined, ids, aujourdhui: '2026-11-04',
  };
  const html = (p: Partial<React.ComponentProps<typeof CorpsDefinirAction>> = {}) => renderToStaticMarkup(<CorpsDefinirAction {...base} {...p} />);

  it('champs : intitulé (focus à l’ouverture), précisions avec compteur, responsable, échéance facultative', () => {
    const h = html();
    expect(h).toContain('data-autofocus');
    expect(h).toContain('>Action <');
    expect(h).toContain('Précisions');
    expect(h).toContain('0 / 500 caractères');
    expect(h).toContain('Échéance');
    expect(h).toContain('Sans date, l’action sera enregistrée « sans échéance ».');
    expect(h).toContain('min="2026-11-04"');
  });

  it('le sélecteur ne propose QUE des personnes de l’agence du problème (+ moi, + « sans responsable »)', () => {
    const h = html();
    expect(h).toContain('Moi (Awa Traoré)');
    expect(h).toContain('Issa Bado');
    expect(h).not.toContain('Zoé Autre');
    expect(h).toContain('Sans responsable pour l’instant');
    expect(h).toContain('Choisir un responsable');
  });

  it('chargement de la liste : sélecteur désactivé et libellé honnête', () => {
    const h = html({ responsables: { statut: 'chargement' } });
    expect(h).toContain('Chargement des responsables…');
    expect(h).toMatch(/<select[^>]*disabled/);
  });

  it('liste illisible : message, « Recharger la liste », et le choix « sans responsable » reste possible', () => {
    const h = html({ responsables: { statut: 'erreur' }, personnes: [{ id: 'moi', libelle: 'Moi (Awa Traoré)' }] });
    expect(h).toContain('La liste des responsables n’a pas pu être chargée.');
    expect(h).toContain('Recharger la liste');
    expect(h).toContain('Sans responsable pour l’instant');
    expect(h).not.toContain('Zoé Autre');
  });

  it('erreurs de champ : aria-invalid, message lié au champ et annoncé', () => {
    const h = html({ erreurs: { titre: 'Décrivez l’action en 3 caractères minimum.', responsable: 'Choisissez un responsable' } });
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('id="t-erreur"');
    expect(h).toContain('aria-describedby="t-erreur"');
    expect(h).toContain('role="alert"');
    expect(h).toContain('id="r-erreur"');
  });

  it('erreur serveur / réseau : message + « Réessayer » ; la saisie reste dans les champs', () => {
    const h = html({ saisie: { titre: 'Réparer', description: 'vite', responsableId: 'a1', echeance: '2026-11-20' }, echec: { nature: 'serveur', message: MESSAGES_DEFINIR.serveur } });
    expect(h).toContain(MESSAGES_DEFINIR.serveur);
    expect(h).toContain('Réessayer');
    expect(h).toContain('value="Réparer"');
    expect(h).toContain('vite');
    expect(h).toContain('value="2026-11-20"');
  });

  it('403 : message sans « Réessayer » (inutile) ; 422 : idem, on corrige puis on renvoie', () => {
    for (const echec of [{ nature: 'refus' as const, message: MESSAGES_DEFINIR.refus }, { nature: 'saisie' as const, message: MESSAGES_DEFINIR.saisie }]) {
      const h = html({ echec });
      expect(h).toContain(echec.message);
      expect(h).not.toContain('Réessayer');
    }
  });

  it('pied : pendant l’envoi, Annuler est désactivé et le bouton d’envoi est occupé (pas de double envoi)', () => {
    const repos = renderToStaticMarkup(<PiedDefinirAction envoi={false} formulaire="f" onAnnuler={() => undefined} />);
    expect(repos).toContain('Définir l’action');
    expect(repos).toContain('type="submit"');
    const envoi = renderToStaticMarkup(<PiedDefinirAction envoi formulaire="f" onAnnuler={() => undefined} />);
    expect(envoi).toContain('Enregistrement…');
    expect(envoi.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
    expect(envoi).toContain('aria-busy="true"');
  });

  it('champs en lecture seule pendant l’envoi', () => {
    expect(html({ envoi: true })).toMatch(/readOnly|readonly/i);
  });
});

describe('confirmation avant de terminer une action', () => {
  it('le texte de conséquence exact est affiché avant l’envoi', () => {
    expect(TEXTE_CONFIRMATION_TERMINER).toBe('Cette action sera marquée comme terminée. Cette décision ne peut pas être annulée pour l’instant.');
    expect(renderToStaticMarkup(<CorpsTerminerAction derniere={false} echec={null} envoi={false} onReessayer={() => undefined} />)).toContain(TEXTE_CONFIRMATION_TERMINER);
  });

  it('dernière action : on prévient que le problème passera à « Résolu »', () => {
    expect(renderToStaticMarkup(<CorpsTerminerAction derniere echec={null} envoi={false} onReessayer={() => undefined} />)).toContain('le problème passera à « Résolu »');
    expect(renderToStaticMarkup(<CorpsTerminerAction derniere={false} echec={null} envoi={false} onReessayer={() => undefined} />)).not.toContain('passera à « Résolu »');
  });

  it('« Annuler » reçoit le focus (choix sûr) ; pendant l’envoi les deux boutons sont désactivés', () => {
    const repos = renderToStaticMarkup(<PiedTerminerAction envoi={false} onAnnuler={() => undefined} onConfirmer={() => undefined} />);
    expect(repos).toMatch(/data-autofocus[^>]*>Annuler/);
    expect(repos).toContain('Terminer l’action');
    const envoi = renderToStaticMarkup(<PiedTerminerAction envoi onAnnuler={() => undefined} onConfirmer={() => undefined} />);
    expect(envoi.match(/disabled/g)?.length).toBe(2);
    expect(envoi).toContain('Enregistrement…');
  });

  it('500 : « Réessayer » ; 403 : pas de « Réessayer »', () => {
    expect(renderToStaticMarkup(<CorpsTerminerAction derniere={false} echec={{ nature: 'serveur', message: 'Oups' }} envoi={false} onReessayer={() => undefined} />)).toContain('Réessayer');
    expect(renderToStaticMarkup(<CorpsTerminerAction derniere={false} echec={{ nature: 'refus', message: 'Non' }} envoi={false} onReessayer={() => undefined} />)).not.toContain('Réessayer');
  });
});

describe('garde-fou : aucun envoi d’action sans passer par la boîte de dialogue', () => {
  const racine = new URL('../../', import.meta.url);
  const sources: string[] = (readdirSync(racine, { recursive: true }) as string[])
    .map((f) => f.split('\\').join('/'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|^services\/api\.ts$/.test(f));
  const quiAppelle = (motif: RegExp) => sources.filter((f) => motif.test(readFileSync(new URL(f, racine), 'utf8') as string));

  it('la clôture d’une action n’est envoyée que depuis la confirmation (TerminerActionDialog)', () => {
    expect(quiAppelle(/\.terminerAction/)).toEqual(['components/issues/TerminerActionDialog.tsx']);
  });

  it('la création d’une action n’est envoyée que depuis la boîte « Définir une action »', () => {
    expect(quiAppelle(/\.creerAction/)).toEqual(['components/issues/DefinirActionDialog.tsx']);
  });
});

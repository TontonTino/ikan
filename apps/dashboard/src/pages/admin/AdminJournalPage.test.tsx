import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { JournalAuditEntree } from '../../types';
import { ROLE_NAV_SECTIONS, ROUTE_ROLES } from '../../components/layout/navigation';
import { LIBELLES_ACTION, libelleAction, resumeDetails } from '../../utils/journalAudit';
import { JournalVue } from './AdminJournalPage';
import source from './AdminJournalPage.tsx?raw';

// Les 19 codes émis par l'API (app/services/journal_audit.py : CODES_ACTION).
const CODES_API = [
  'organisation.creee', 'organisation.modifiee', 'organisation.desactivee', 'organisation.reactivee', 'forfait.modifie', 'compte.cree',
  'compte.modifie', 'compte.suspendu', 'compte.admin_cree', 'compte.mot_de_passe_reinitialise', 'compte.mot_de_passe_modifie', 'agence.creee', 'agence.modifiee', 'agence.supprimee', 'qr_code.supprime',
  'parametres.modifies', 'protection.dernier_admin_refuse', 'auth.connexion_echouee', 'auth.connexion_limitee',
];

const ligne = (action: string, extra: Partial<JournalAuditEntree> = {}): JournalAuditEntree => ({
  id: action, date_action: '2026-11-01T10:00:00Z', acteur_id: null, acteur_role: 'admin', acteur_email: 'admin@exemple.tn', action,
  cible_type: 'utilisateur', cible_id: 'x', cible_libelle: 'Leila', organisation_id: null, resultat: 'succes', details: { champs: ['role'] },
  adresse_ip: '10.0.0.0', ...extra,
});

describe('Journal d’audit — libellés', () => {
  it('chaque code de l’API a un libellé français, et aucun code technique n’est affiché', () => {
    expect(Object.keys(LIBELLES_ACTION).sort()).toEqual([...CODES_API].sort());
    const html = renderToStaticMarkup(<JournalVue lignes={CODES_API.map((c) => ligne(c))} chargement={false} erreur="" />);
    for (const code of CODES_API) {
      expect(libelleAction(code)).not.toBe('Action non répertoriée');
      expect(html).toContain(libelleAction(code));
      expect(html).not.toContain(code);
    }
  });

  it('un code inconnu reste lisible, sans afficher le code', () => {
    const html = renderToStaticMarkup(<JournalVue lignes={[ligne('futur.code')]} chargement={false} erreur="" />);
    expect(html).toContain('Action non répertoriée');
    expect(html).not.toContain('futur.code');
  });

  it('le détail n’affiche que les champs modifiés, jamais le JSON brut', () => {
    expect(resumeDetails({ champs: ['role', 'active'], password: 'x' })).toBe('Champs : role, active');
    expect(resumeDetails(null)).toBe('');
  });
});

describe('Journal d’audit — états', () => {
  it('état vide en français', () => {
    const html = renderToStaticMarkup(<JournalVue lignes={[]} chargement={false} erreur="" />);
    expect(html).toContain('Aucune action enregistrée');
  });

  it('erreur serveur : message en français, tableau masqué', () => {
    const html = renderToStaticMarkup(<JournalVue lignes={[]} chargement={false} erreur="Ce journal est réservé aux administrateurs." />);
    expect(html).toContain('Ce journal est réservé aux administrateurs.');
    expect(html).not.toContain('<table');
  });

  it('tableau défilant dans son conteneur (mobile) et en lecture seule', () => {
    const html = renderToStaticMarkup(<JournalVue lignes={[ligne('compte.cree')]} chargement={false} erreur="" />);
    expect(html).toContain('ui-table-wrap');
    expect(html).not.toMatch(/<button[^>]*>(Supprimer|Modifier|Effacer)/);
    expect(source).not.toMatch(/\.(post|put|patch|delete)\(/);
  });
});

describe('Journal d’audit — accès', () => {
  it('route et menu réservés à l’administrateur', () => {
    expect(ROUTE_ROLES['/admin/journal']).toEqual(['admin']);
    const chemins = (r: 'admin' | 'cx_manager' | 'agency_manager') => ROLE_NAV_SECTIONS[r].flatMap((s) => s.items.map((i) => i.path));
    expect(chemins('admin')).toContain('/admin/journal');
    expect(chemins('cx_manager')).not.toContain('/admin/journal');
    expect(chemins('agency_manager')).not.toContain('/admin/journal');
  });
});

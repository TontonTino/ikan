import { describe, expect, it } from 'vitest';
import type { UserRole } from '../../types';
import { ROLE_HOME, ROLE_NAV_SECTIONS, ROUTE_ROLES, redirectionRole } from './navigation';

const ROLES: UserRole[] = ['admin', 'cx_manager', 'agency_manager'];
const liens = (role: UserRole) => ROLE_NAV_SECTIONS[role].flatMap((section) => section.items);
const chemins = (role: UserRole) => liens(role).map((item) => item.path);
const libelles = (role: UserRole) => liens(role).map((item) => item.label);

describe('sidebar du CX Manager', () => {
  it('n’affiche plus Suggestions ni Demandes de rappel, ni « Avis clients » (remplacé par « Avis du réseau »)', () => {
    const cx = chemins('cx_manager');
    for (const chemin of ['/suggestions', '/demandes-rappel']) expect(cx).not.toContain(chemin);
    for (const libelle of ['Avis clients', 'Suggestions', 'Demandes de rappel']) expect(libelles('cx_manager')).not.toContain(libelle);
  });

  it('affiche « Avis du réseau » (liste des avis de toutes les agences de l’organisation, CX-04)', () => {
    const entree = liens('cx_manager').find((item) => item.path === '/feedbacks');
    expect(entree?.label).toBe('Avis du réseau');
    expect(ROUTE_ROLES['/feedbacks']).toContain('cx_manager');
    expect(chemins('cx_manager').filter((chemin) => chemin === '/feedbacks')).toHaveLength(1);
  });

  it('n’a plus de section vide', () => {
    for (const section of ROLE_NAV_SECTIONS.cx_manager) expect(section.items.length).toBeGreaterThan(0);
  });

  it('garde ses autres entrées', () => {
    expect(chemins('cx_manager')).toEqual(
      expect.arrayContaining(['/siege', '/statistiques', '/alertes', '/issues', '/actions', '/veille', '/admin/gestion-agences']),
    );
  });
});

describe('navigation des autres rôles', () => {
  it('le Responsable d’agence conserve Avis clients, Suggestions et Demandes de rappel', () => {
    expect(chemins('agency_manager')).toEqual(expect.arrayContaining(['/feedbacks', '/suggestions', '/demandes-rappel']));
  });

  it('libellé officiel exact « Demandes de rappel » (jamais « Rappel clients »)', () => {
    const am = liens('agency_manager').find((item) => item.path === '/demandes-rappel');
    expect(am?.label).toBe('Demandes de rappel');
    for (const role of ROLES) expect(libelles(role).join('|')).not.toMatch(/rappel clients/i);
  });

  it('l’administrateur n’a aucune entrée de données clients', () => {
    expect(chemins('admin').every((chemin) => chemin.startsWith('/admin/'))).toBe(true);
  });
});

describe('cohérence navigation / gardes de routes', () => {
  it('chaque entrée visible est autorisée pour le rôle', () => {
    for (const role of ROLES) for (const chemin of chemins(role)) expect(ROUTE_ROLES[chemin.split('?')[0]]).toContain(role);
  });

  it('les routes restent ouvertes au CX Manager (liens existants, favoris) même sans entrée de sidebar', () => {
    for (const route of ['/feedbacks', '/suggestions', '/demandes-rappel', '/agences/:agenceId/apercu']) {
      expect(ROUTE_ROLES[route]).toContain('cx_manager');
    }
  });

  it('l’accueil de chaque rôle lui est autorisé : aucune boucle de redirection', () => {
    for (const role of ROLES) expect(redirectionRole(role, ROLE_HOME[role])).toBeNull();
  });
});

describe('route /agence', () => {
  it('le CX Manager est redirigé vers /siege', () => {
    expect(redirectionRole('cx_manager', '/agence')).toBe('/siege');
  });

  it('le Responsable d’agence y accède', () => {
    expect(redirectionRole('agency_manager', '/agence')).toBeNull();
  });

  it('l’administrateur garde son comportement (renvoi vers son tableau de bord)', () => {
    expect(redirectionRole('admin', '/agence')).toBe('/admin/dashboard');
  });

  it('une route inconnue est refusée par défaut', () => {
    expect(redirectionRole('cx_manager', '/inexistante')).toBe('/siege');
  });
});

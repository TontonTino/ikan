import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types';
import SidebarWorkspaceCard from '../components/layout/SidebarWorkspaceCard';
import { initialesOrganisation } from '../utils/initialesOrganisation';
import FeedbacksPage from './agency/FeedbacksPage';
import GestionAgencesPage from './admin/GestionAgencesPage';
import sourceSiege from './cx/siege/SiegeBlocks.tsx?raw';
import sourceAgence from '../components/agency/AgencyEvolution.tsx?raw';

// En rendu serveur, le magasin zustand renvoie son état INITIAL : on le remplace par un état contrôlé.
const etat = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../stores/authStore', () => ({ useAuthStore: (selecteur: (s: { user: unknown }) => unknown) => selecteur({ user: etat.user }) }));
vi.mock('./admin/AdminAgencesContent', () => ({ default: () => <p>contenu agences</p> }));
vi.mock('./admin/AdminUsersContent', () => ({ default: () => <p>contenu comptes</p> }));

const utilisateur = (role: User['role'], extra: Partial<User> = {}): User =>
  ({ id: 'u1', nom: 'N', prenom: 'P', email: 'u@test.io', role, organisation_id: 'o1', organisation_nom: 'Restaurant Le Prestige', agence_id: role === 'agency_manager' ? 'a1' : null,
     agence_nom: role === 'agency_manager' ? 'Ouaga 2000' : null, ...extra } as User);

const dans = (noeud: React.ReactNode, location = '/') => renderToStaticMarkup(<StaticRouter location={location}>{noeud}</StaticRouter>);

beforeEach(() => { etat.user = null; });

describe('initiales de l’organisation (repli sans logo)', () => {
  it.each([
    ['Orange', 'OR'],
    ['Orange Bank', 'OB'],
    ['Restaurant Le Prestige', 'RP'],
    ['RESTAURANT LE PRESTIGE', 'RP'],
    ['Banque de l’Atlantique du Faso', 'BA'],
    ['Jean-Pierre Martin', 'JP'],
    ['le', 'LE'],
    ['  élan   vital ', 'ÉV'],
    ['', 'O'],
    [null, 'O'],
    [undefined, 'O'],
  ])('« %s » → %s', (nom, attendu) => {
    expect(initialesOrganisation(nom as string | null | undefined)).toBe(attendu);
  });

  it('1, 2 et 3 mots : toujours deux lettres', () => {
    for (const nom of ['Novax', 'Nova Xtra', 'Nova Xtra Group']) expect(initialesOrganisation(nom)).toHaveLength(2);
  });
});

describe('carte de contexte de la barre latérale', () => {
  it('sans logo : deux initiales et le nom complet accessible', () => {
    etat.user = utilisateur('cx_manager');
    const html = dans(<SidebarWorkspaceCard user={etat.user as User} />);
    expect(html).toContain('>RP<');
    expect(html).toContain('role="img" aria-label="Restaurant Le Prestige"');
    expect(html).toContain('aria-label="Sélectionner une agence dans Restaurant Le Prestige"');   // comportement existant conservé
  });

  it('Agency Manager : même repli, bouton « Ouvrir Mon agence » inchangé', () => {
    const html = dans(<SidebarWorkspaceCard user={utilisateur('agency_manager', { organisation_nom: 'Orange Bank' })} />);
    expect(html).toContain('>OB<');
    expect(html).toContain('aria-label="Orange Bank"');
    expect(html).toContain('Ouvrir Mon agence.');
  });

  it('avec un logo : l’image, pas les initiales', () => {
    const html = dans(<SidebarWorkspaceCard user={utilisateur('cx_manager', { organisation_logo: 'https://exemple.org/logo.png' } as Partial<User>)} />);
    expect(html).toContain('src="https://exemple.org/logo.png"');
    expect(html).not.toContain('>RP<');
  });
});

describe('titres de page', () => {
  it('Avis du réseau (CX Manager) : titre et phrase', () => {
    etat.user = utilisateur('cx_manager');
    const html = dans(<FeedbacksPage />, '/feedbacks');
    expect(html).toContain('<h1 class="ui-page-title__h1">Avis du réseau</h1>');
    expect(html).toContain('Les avis clients de toutes les agences de votre réseau.');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('Avis clients (Agency Manager) : titre et phrase', () => {
    etat.user = utilisateur('agency_manager');
    const html = dans(<FeedbacksPage />, '/feedbacks');
    expect(html).toContain('<h1 class="ui-page-title__h1">Avis clients</h1>');
    expect(html).toContain('Les avis clients de votre agence.');
  });

  it('liste intégrée à la page d’une agence (agenceId) : pas de second titre', () => {
    etat.user = utilisateur('cx_manager');
    expect(dans(<FeedbacksPage agenceId="a1" />, '/agences/a1/apercu')).not.toContain('<h1');
  });

  it('le reste de la page est inchangé (onglets, filtres)', () => {
    etat.user = utilisateur('cx_manager');
    const html = dans(<FeedbacksPage />, '/feedbacks');
    expect(html).toContain('aria-label="Filtrer par agence"');
    expect(html).toContain('Tous les avis');
  });

  it('Gestion des agences (CX Manager) : titre et phrase, contenu conservé ; l’Administrateur n’est pas modifié', () => {
    etat.user = utilisateur('cx_manager');
    const html = dans(<GestionAgencesPage />, '/admin/gestion-agences');
    expect(html).toContain('<h1 class="ui-page-title__h1">Gestion des agences</h1>');
    expect(html).toContain('Agences, QR codes et responsables d’agence de votre réseau.');
    expect(html).toContain('contenu agences');
    etat.user = utilisateur('admin');
    const admin = dans(<GestionAgencesPage />, '/admin/gestion-agences');
    expect(admin).not.toContain('<h1');
    expect(admin).toContain('contenu comptes');
  });
});

describe('graphique « Évolution de la satisfaction » : segments droits', () => {
  it('Vue réseau et page agence : plus de courbe interpolée, points creux et note de YAM conservés', () => {
    expect(sourceSiege).toContain('<Line type="linear" dataKey="satisfaction"');
    expect(sourceAgence).toContain('<Area type="linear" dataKey="taux"');
    expect(sourceSiege).not.toContain('type="monotone"');
    expect(sourceAgence).not.toContain('type="monotone"');
    expect(sourceSiege).toContain('<YamNote pointsFaibleVolume={faibles} />');
    expect(sourceAgence).toContain('<YamNote');
    expect(sourceSiege).toContain('FAIBLE_VOLUME_POINT');
  });
});

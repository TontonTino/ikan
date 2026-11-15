import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SidebarWorkspaceCard from './SidebarWorkspaceCard';
import sourceSelecteur from './SelecteurPerimetre.tsx?raw';
import sourceCarte from './SidebarWorkspaceCard.tsx?raw';
import type { User } from '../../types';

const utilisateur = (role: User['role'], extra: Partial<User> = {}): User =>
  ({ id: 'u1', nom: 'N', prenom: 'P', email: 'u@test.io', role, organisation_id: 'o1', organisation_nom: 'Orange Burkina Faso', agence_id: null, agence_nom: null, ...extra } as User);
const dans = (noeud: React.ReactNode, location = '/siege') => renderToStaticMarkup(<StaticRouter location={location}>{noeud}</StaticRouter>);

describe('carte d’espace : qui et quoi, lisibles sans survol', () => {
  it('admin : carte d’information (aucune action), logo IKAN AI, plus d’avatar dessiné', () => {
    const html = dans(<SidebarWorkspaceCard user={utilisateur('admin')} />);
    expect(html).toContain('role="group" aria-label="IKAN AI, Administration"');
    expect(html).toContain('src="/ikanai-mark.png"');
    expect(html).not.toMatch(/<button/);
    expect(sourceCarte).not.toContain('AdminProfessionalAvatar');
  });

  it('menu replié : le logo seul, nom et contexte restent dans le nom accessible', () => {
    const html = dans(<SidebarWorkspaceCard user={utilisateur('cx_manager')} collapsed />);
    expect(html).toContain('espace-carte--replie');
    expect(html).not.toContain('class="espace-nom"');
    expect(html).toContain('aria-label="Périmètre affiché : Orange Burkina Faso, Toutes les agences. Changer de périmètre."');
  });

  it('sur l’aperçu d’une agence, la carte parle de cette agence (jamais « Toutes les agences »)', () => {
    const html = dans(<SidebarWorkspaceCard user={utilisateur('cx_manager')} />, '/agences/a1/apercu');
    expect(html).not.toContain('>Toutes les agences<');
  });
});

describe('liste du sélecteur : choix techniques qui corrigent les défauts relevés', () => {
  it('en portail et en position fixe : le menu latéral ne la coupe plus', () => {
    expect(sourceSelecteur).toContain('createPortal(');
    expect(sourceSelecteur).toContain("position: 'fixed'");
  });

  it('combobox accessible : flèches, Entrée, Échap qui rend le focus à la carte', () => {
    for (const touche of ["'ArrowDown'", "'ArrowUp'", "'Enter'", "'Escape'", "'Home'", "'End'"]) expect(sourceSelecteur).toContain(touche);
    expect(sourceSelecteur).toContain('aria-activedescendant');
    expect(sourceSelecteur).toContain('role="listbox"');
    expect(sourceSelecteur).toContain('ancre.current?.focus()');
  });

  it('agences groupées par ville, coche sur l’agence affichée (pas la couleur seule)', () => {
    expect(sourceSelecteur).toContain('agencesParVille(agences, recherche)');
    expect(sourceSelecteur).toContain('role="group" aria-label={groupe.ville}');
    expect(sourceSelecteur).toContain('{choisie && <CheckIcon size={16} />}');
    expect(sourceSelecteur).toContain('aria-selected={choisie}');
  });

  it('états chargement, erreur avec « Réessayer », recherche vide avec « Effacer la recherche »', () => {
    expect(sourceSelecteur).toContain('aria-label="Chargement des agences"');
    expect(sourceSelecteur).toContain('>Réessayer</button>');
    expect(sourceSelecteur).toContain('Effacer la recherche');
  });
});

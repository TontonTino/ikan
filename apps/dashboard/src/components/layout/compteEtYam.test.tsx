import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import UserMenu from './UserMenu';
import YamBoutonEntete from './YamBoutonEntete';
import sourceLayout from './DashboardLayout.tsx?raw';
import sourceMenu from './Sidebar.tsx?raw';
import type { User } from '../../types';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const UTILISATEUR = { id: 'u1', prenom: 'Awa', nom: 'Ouédraogo', email: 'cx@exemple.test', role: 'cx_manager', organisation_nom: 'Orange Burkina Faso' } as unknown as User;

describe('le compte est en bas du menu latéral, YAM en haut à droite', () => {
  it('le menu latéral porte le compte à la place de l’ancien bouton YAM', () => {
    expect(sourceMenu).toContain('<UserMenu user={user} onLogout={onLogout} placement="menu" collapsed={collapsed} />');
    expect(sourceMenu).not.toContain('ikan-yam-button');
  });

  it('l’en-tête porte YAM (rôles qui y ont accès) et plus le compte', () => {
    expect(sourceLayout).toContain('{canUseYam && <YamBoutonEntete ouvert={yamOpen} onBasculer={toggleYam} />}');
    expect(sourceLayout).not.toMatch(/<UserMenu\b/);
  });

  it('YAM est le dernier élément de l’en-tête, après la cloche (coin droit)', () => {
    const cloche = sourceLayout.indexOf('<NotificationCenter');
    const yam = sourceLayout.indexOf('<YamBoutonEntete');
    expect(yam).toBeGreaterThan(cloche);
    expect(sourceLayout.slice(yam, sourceLayout.indexOf('</header>'))).not.toMatch(/<(button|NotificationCenter|UserMenu)\b/);
  });
});

describe('bouton YAM de l’en-tête', () => {
  it('nommé, relié au panneau, état ouvert annoncé', () => {
    const ferme = renderToStaticMarkup(<YamBoutonEntete ouvert={false} onBasculer={() => undefined} />);
    expect(ferme).toContain('aria-label="Demander à YAM, assistant IA"');
    expect(ferme).toContain('aria-expanded="false"');
    expect(ferme).toMatch(/aria-controls="[^"]+"/);
    expect(ferme).toContain('Demander à YAM');
    const ouvert = renderToStaticMarkup(<YamBoutonEntete ouvert onBasculer={() => undefined} />);
    expect(ouvert).toContain('aria-expanded="true"');
    expect(ouvert).toContain('yam-entete--ouvert');
  });
});

describe('compte dans le menu latéral', () => {
  it('ouvert : avatar, nom et organisation, chevron vers le haut', () => {
    const html = renderToStaticMarkup(<UserMenu user={UTILISATEUR} onLogout={() => undefined} placement="menu" />);
    expect(html).toContain('class="user-menu-lateral"');
    expect(html).toContain('>AO<');
    expect(html).toContain('Awa Ouédraogo');
    expect(html).toContain('Orange Burkina Faso');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('replié : l’avatar seul, avec un nom accessible', () => {
    const html = renderToStaticMarkup(<UserMenu user={UTILISATEUR} onLogout={() => undefined} placement="menu" collapsed />);
    expect(html).toContain('user-menu-lateral--replie');
    expect(html).toContain('aria-label="Compte de Awa Ouédraogo"');
    expect(html).not.toContain('Orange Burkina Faso');
  });

  it('l’en-tête garde sa pastille d’origine si le compte y revient (placement par défaut)', () => {
    const html = renderToStaticMarkup(<UserMenu user={UTILISATEUR} onLogout={() => undefined} />);
    expect(html).toContain('user-menu__nom');
    expect(html).not.toContain('user-menu-lateral');
  });
});

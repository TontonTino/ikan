import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';
import { QuiContacter } from './MotDePasseOublie';
import sourceOubli from './MotDePasseOublie.tsx?raw';
import { SUPPORT_EMAIL } from '../utils/contact';

vi.mock('../stores/authStore', () => ({ useAuthStore: (selecteur: (s: unknown) => unknown) => selecteur({ user: null, login: vi.fn() }) }));

const page = () => renderToStaticMarkup(<StaticRouter location="/login"><LoginPage /></StaticRouter>);

describe('page de connexion (lot 6)', () => {
  it('l’exemple d’adresse est neutre (plus d’adresse tunisienne)', () => {
    const html = page();
    expect(html).toContain('placeholder="prenom.nom@entreprise.com"');
    expect(html).not.toContain('orange.tn');
  });

  it('le champ mot de passe est vide : aucun exemple qui le ferait croire rempli', () => {
    const champ = /<input[^>]*id="login-password"[^>]*>/.exec(page())?.[0] ?? '';
    expect(champ).not.toBe('');
    expect(champ).not.toContain('placeholder');
  });

  it('un lien « Mot de passe oublié ? » suit le champ mot de passe, avant le bouton de connexion', () => {
    const html = page();
    const champ = html.indexOf('id="login-password"');
    const lien = html.indexOf('Mot de passe oublié ?');
    expect(lien).toBeGreaterThan(champ);
    expect(lien).toBeLessThan(html.indexOf('Se connecter'));
    expect(html).toMatch(/<button type="button" class="login-oubli">Mot de passe oublié \?<\/button>/);
  });

  it('pas de fausse page : le lien ouvre une boîte, aucune route ni aucun appel', () => {
    expect(sourceOubli).not.toMatch(/navigate|<Link|href="\/|fetch\(|api\./);
    expect(sourceOubli).toContain('<Modal');
  });

  it('la boîte dit qui contacter selon le rôle, avec l’adresse de l’équipe IKAN AI', () => {
    const html = renderToStaticMarkup(<QuiContacter />);
    expect(html).toContain('Vous êtes responsable d’agence');
    expect(html).toContain('Demandez au responsable expérience client de votre entreprise.');
    expect(html).toContain('Vous êtes responsable expérience client');
    expect(html).toContain(`>${SUPPORT_EMAIL}</a>`);
    expect(html).toContain(`href="mailto:${SUPPORT_EMAIL}?subject=`);
  });
});

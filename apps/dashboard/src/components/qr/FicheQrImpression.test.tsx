import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lienFeedbackAgence } from '../../utils/qrCode';
import css from './ficheQr.css?raw';
import { CLASSE_IMPRESSION_QR, FicheQrContenu, PHRASE_INVITATION_QR, imprimerFicheQr } from './FicheQrImpression';

const URL_AGENCE = 'https://ikan-1.onrender.com/feedback/QR-AGENCE-AB12CD';
const rendu = (nom: string, url = URL_AGENCE) => renderToStaticMarkup(<FicheQrContenu nom={nom} url={url} />);

afterEach(() => vi.unstubAllGlobals());

describe('contenu de la feuille à imprimer', () => {
  it('contient le nom de l’agence, la phrase d’invitation, le QR et l’adresse en clair', () => {
    const html = rendu('Agence Centre-Ville');
    expect(html).toContain('<h1 class="fiche-qr__nom">Agence Centre-Ville</h1>'); // titre visible (le nom est aussi dans les libellés d’accessibilité)
    expect(html).toContain('Scannez pour donner votre avis');
    expect(PHRASE_INVITATION_QR).toBe('Scannez pour donner votre avis');
    expect(html).toContain(`<p class="fiche-qr__url">${URL_AGENCE}</p>`);
    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="QR code de Agence Centre-Ville"');
  });

  it('aucun bouton, aucun lien, aucun élément du dashboard sur la feuille', () => {
    const html = rendu('Agence Centre-Ville');
    expect(html).not.toMatch(/<button|<a |<nav|<aside|<input|<select/);
  });

  it('l’adresse n’apparaît qu’une fois en clair : le dessin du QR ne porte aucune donnée textuelle', () => {
    const html = rendu('Agence Centre-Ville');
    expect(html.split(URL_AGENCE)).toHaveLength(2);
    const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
    expect(svg).not.toMatch(/<text|<image|<title|href=/);
  });

  it('un nom d’agence contenant du HTML est affiché comme du texte', () => {
    const html = rendu('<script>alert(1)</script> & Cie');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Cie');
  });

  it('agence sans QR actif : la feuille porte le lien de repli (identifiant de l’agence)', () => {
    const lien = lienFeedbackAgence({ id: 'b3a1f0d2-0000-4000-8000-000000000001', qr_code_token: null });
    const html = rendu('Agence sans code', lien);
    expect(html).toContain(`${lien}</p>`);
    expect(lien).toContain('/feedback/b3a1f0d2-0000-4000-8000-000000000001');
  });
});

describe('feuille de style d’impression', () => {
  it('la feuille est invisible à l’écran', () => {
    expect(css).toMatch(/\.fiche-qr-impression\s*\{\s*display:\s*none;/);
  });

  it('à l’impression : tout le reste du dashboard est masqué, seule la feuille s’affiche, en A4', () => {
    expect(css).toContain('@media print');
    expect(css).toMatch(/html\.impression-qr body > \*:not\(\.fiche-qr-impression\)\s*\{\s*display:\s*none !important;/);
    expect(css).toMatch(/html\.impression-qr \.fiche-qr-impression\s*\{\s*display:\s*block !important;/);
    expect(css).toMatch(/@page fiche-qr\s*\{\s*size:\s*A4 portrait;/);
  });

  it('noir sur blanc imprimé tel quel, URL qui passe à la ligne', () => {
    expect(css).toMatch(/print-color-adjust:\s*exact/);
    expect(css).toMatch(/\.fiche-qr__url[\s\S]*?overflow-wrap:\s*anywhere/);
  });
});

describe('bouton « Imprimer »', () => {
  it('pose l’état d’impression, ouvre la boîte d’impression, puis le retire quand elle se ferme', () => {
    const classes = new Set<string>();
    const ecouteurs: Record<string, () => void> = {};
    const impression = vi.fn();
    vi.stubGlobal('document', { documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } });
    vi.stubGlobal('window', {
      print: impression,
      addEventListener: (nom: string, fn: () => void) => { ecouteurs[nom] = fn; },
      removeEventListener: (nom: string) => { delete ecouteurs[nom]; },
    });
    imprimerFicheQr();
    expect(impression).toHaveBeenCalledTimes(1);
    expect(classes.has(CLASSE_IMPRESSION_QR)).toBe(true);
    ecouteurs.afterprint();
    expect(classes.has(CLASSE_IMPRESSION_QR)).toBe(false);
    expect(ecouteurs.afterprint).toBeUndefined();
  });
});

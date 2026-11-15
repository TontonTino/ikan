import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VeilleFacebookStatus, VeilleMention as Mention, VeilleSyntheseResponse } from '../../types';
import { depuis, etatSource } from './VeilleSource';
import VeilleSynthese, { themeDominant } from './VeilleSynthese';
import VeilleThemes from './VeilleThemes';
import VeilleMention, { TEXTE_LONG } from './VeilleMention';

const page = (p: Partial<VeilleFacebookStatus['pages'][number]> = {}) => ({
  id: 'p', page_id: '1', page_name: 'Ma Page', status: 'active' as const, expires_at: 0, data_access_expires_at: null, needs_attention: false, last_sync_at: null, ...p,
});

describe('Source des mentions : un état unique, déduit du statut', () => {
  it('chargement, hors ligne, pages illisibles, aucune page', () => {
    expect(etatSource(undefined)).toBe('chargement');
    expect(etatSource(null)).toBe('hors-ligne');
    expect(etatSource({ service: 'offline', pages_disponibles: true, pages: [page()] })).toBe('hors-ligne');
    expect(etatSource({ service: 'online', pages_disponibles: false, pages: [] })).toBe('pages-inconnues');
    expect(etatSource({ service: 'online', pages_disponibles: true, pages: [] })).toBe('sans-page');
  });

  it('une Page active suffit ; sinon la session est à renouveler', () => {
    expect(etatSource({ service: 'online', pages_disponibles: true, pages: [page()] })).toBe('connectee');
    expect(etatSource({ service: 'online', pages_disponibles: true, pages: [page({ status: 'reauth_required' })] })).toBe('a-renouveler');
    expect(etatSource({ service: 'online', pages_disponibles: true, pages: [page({ needs_attention: true })] })).toBe('a-renouveler');
  });

  it('dernière collecte en relatif, jamais « NaN »', () => {
    const maintenant = new Date('2026-11-15T12:00:00Z');
    expect(depuis(null, maintenant)).toBeNull();
    expect(depuis('pas une date', maintenant)).toBeNull();
    expect(depuis('2026-11-15T11:59:40Z', maintenant)).toBe('à l’instant');
    expect(depuis('2026-11-15T11:35:00Z', maintenant)).toBe('il y a 25 min');
    expect(depuis('2026-11-15T09:00:00Z', maintenant)).toBe('il y a 3 h');
    expect(depuis('2026-11-12T12:00:00Z', maintenant)).toBe('il y a 3 j');
  });
});

const synthese: VeilleSyntheseResponse = {
  total: 12,
  par_sentiment: { positif: { count: 6, pourcentage: 50 }, neutre: { count: 2, pourcentage: 16.7 }, negatif: { count: 4, pourcentage: 33.3 } },
  par_theme: [
    { theme_principal: null, count: 7, pourcentage: 58.3 },
    { theme_principal: 'tarifs', count: 3, pourcentage: 25 },
    { theme_principal: 'attente', count: 2, pourcentage: 16.7 },
  ],
  serie_journaliere: [],
};

describe('Synthèse de la période', () => {
  it('le thème le plus cité ignore « Non classé », même s’il est majoritaire', () => {
    expect(themeDominant(synthese)?.theme_principal).toBe('tarifs');
  });

  it('chaque ton a son libellé et son pourcentage en clair (la couleur n’est jamais seule)', () => {
    const html = renderToStaticMarkup(<VeilleSynthese synthese={synthese} periode="sur les 30 derniers jours" />);
    for (const t of ['Positif', 'Neutre', 'Négatif']) expect(html).toContain(t);
    expect(html).toContain('50 %');
    expect(html).toContain('33 %');
    expect(html).toContain('Tarifs &amp; frais');
    expect(html).toContain('proportions à lire avec prudence');
  });
});

describe('Thèmes classés', () => {
  it('du plus au moins cité, « Non classé » toujours en dernier', () => {
    const html = renderToStaticMarkup(<VeilleThemes data={synthese.par_theme} onChoisir={() => {}} />);
    const ordre = ['Tarifs', 'Attente', 'Non classé'].map((t) => html.indexOf(t));
    expect(ordre.every((i) => i >= 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
  });

  it('le thème choisi est signalé sans la couleur (aria-pressed)', () => {
    const html = renderToStaticMarkup(<VeilleThemes data={synthese.par_theme} onChoisir={() => {}} actif="tarifs" />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Tarifs/);
  });
});

const mention = (m: Partial<Mention> = {}): Mention => ({
  id: 'm', plateforme: 'facebook', type_contenu: 'commentaire', texte: 'Très bon accueil.', sentiment: 'positif', score_sentiment: 0.9,
  theme_principal: 'accueil', theme_confidence: 0.8, date_publication: null, date_analyse: null, url_source: null, agence_nom: null, ...m,
});

describe('Ligne de mention', () => {
  it('un texte court s’affiche en entier, sans « Lire la suite »', () => {
    const html = renderToStaticMarkup(<VeilleMention mention={mention()} />);
    expect(html).not.toContain('veille-mention__texte--replie');
    expect(html).not.toContain('Lire la suite');
    expect(html).toContain('Date inconnue');
  });

  it('un texte long est replié avec un bouton pour le lire', () => {
    const html = renderToStaticMarkup(<VeilleMention mention={mention({ texte: 'x'.repeat(TEXTE_LONG + 1) })} />);
    expect(html).toContain('veille-mention__texte--replie');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Lire la suite');
  });

  it('lien vers la source seulement en https, signalé comme nouvel onglet', () => {
    expect(renderToStaticMarkup(<VeilleMention mention={mention({ url_source: 'javascript:alert(1)' })} />)).not.toContain('<a ');
    const html = renderToStaticMarkup(<VeilleMention mention={mention({ url_source: 'https://www.facebook.com/x/posts/1' })} />);
    expect(html).toContain('href="https://www.facebook.com/x/posts/1"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('(nouvel onglet)');
  });
});

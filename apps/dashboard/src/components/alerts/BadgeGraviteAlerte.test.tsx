import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Alerte } from '../../types';
import BadgeGraviteAlerte from './BadgeGraviteAlerte';
import { LigneSeuil } from '../../pages/cx/PilotageAlertesActionsTab';
import { construirePriorites } from '../agency/agenceVue';

const alerte = (surcharge: Partial<Alerte> = {}): Alerte => ({
  agence_id: 'a1', agence_nom: 'Agence A1', taux_actuel: 40, seuil: 70, message: 'Satisfaction en baisse', ...surcharge,
});
const dansRouteur = (el: React.ReactElement) => renderToStaticMarkup(<StaticRouter location="/alertes">{el}</StaticRouter>);

describe('badge de gravité : libellé texte ET icône', () => {
  it('Critique : texte + icône d’alerte', () => {
    const html = renderToStaticMarkup(<BadgeGraviteAlerte gravite="critique" />);
    expect(html).toContain('Critique');
    expect(html).toContain('<svg');
    expect(html).toContain('ui-badge--critical');
  });

  it('Important : texte + icône (différente de celle de Critique)', () => {
    const critique = renderToStaticMarkup(<BadgeGraviteAlerte gravite="critique" />);
    const important = renderToStaticMarkup(<BadgeGraviteAlerte gravite="important" />);
    expect(important).toContain('Important');
    expect(important).toContain('<svg');
    expect(important).toContain('ui-badge--warning');
    expect(important.match(/<svg[\s\S]*<\/svg>/)?.[0]).not.toBe(critique.match(/<svg[\s\S]*<\/svg>/)?.[0]); // distinguables sans la couleur
  });

  it('sans gravité (ancien serveur) : rien', () => {
    expect(renderToStaticMarkup(<BadgeGraviteAlerte gravite={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<BadgeGraviteAlerte gravite={null} />)).toBe('');
  });
});

describe('carte d’alerte de satisfaction', () => {
  it('affiche la gravité (texte + icône), le taux, le seuil et l’écart en points', () => {
    const html = dansRouteur(<LigneSeuil alerte={alerte({ gravite: 'critique', ecart_seuil: 30 })} isAgencyManager cible={false} />);
    expect(html).toContain('Critique');
    expect(html).toContain('<svg');
    expect(html).toContain('40 %');
    expect(html).toContain('seuil de 70 %');
    expect(html).toContain('30 points sous le seuil');
    expect(html).toContain('Satisfaction sous le seuil');
  });

  it('niveau Important', () => {
    const html = dansRouteur(<LigneSeuil alerte={alerte({ gravite: 'important', ecart_seuil: 10, taux_actuel: 60 })} isAgencyManager cible={false} />);
    expect(html).toContain('Important');
    expect(html).not.toContain('Critique');
    expect(html).toContain('10 points sous le seuil');
  });

  it('ancien serveur sans gravité : libellé d’origine, aucun faux niveau', () => {
    const html = dansRouteur(<LigneSeuil alerte={alerte()} isAgencyManager cible={false} />);
    expect(html).toContain('Satisfaction sous le seuil');
    expect(html).not.toMatch(/Critique|Important|points sous le seuil/);
  });
});

describe('priorités de l’accueil', () => {
  it('la gravité est dite en texte dans le type de la priorité', () => {
    const [p] = construirePriorites({ alertes: [alerte({ gravite: 'critique' })], avis: [], problemes: [] });
    expect(p.type).toBe('Alerte de seuil · Critique');
    const [q] = construirePriorites({ alertes: [alerte()], avis: [], problemes: [] });
    expect(q.type).toBe('Alerte de seuil');
  });
});

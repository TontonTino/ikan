import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Feedback } from '../../types';
import NotificationCenter from './NotificationCenter';
import { estEnRetard, LIEN_FILE_A_TRAITER } from '../../utils/fileATraiter';

const MAINTENANT = new Date('2026-11-12T12:00:00Z');
const ilYA = (heures: number) => new Date(MAINTENANT.getTime() - heures * 3600e3).toISOString();
const avis = (id: string, surcharge: Partial<Feedback> = {}): Feedback => ({
  id, qr_code_id: 'q', note: 1, commentaire: `Avis ${id}`, date_soumission: ilYA(2), statut_traitement: 'nouveau', agence_nom: 'Agence A1', ...surcharge,
});
const cloche = (liste: Feedback[], total: number, showAgency = false) => renderToStaticMarkup(
  <StaticRouter location="/"><NotificationCenter file={{ avis: liste, total }} loading={false} showAgency={showAgency} defaultOpen maintenant={MAINTENANT} /></StaticRouter>,
);

describe('cloche = file « À traiter », et rien d’autre', () => {
  it('le compteur est le total de la file (pas le nombre affiché, pas des « nouveautés »)', () => {
    const html = cloche([avis('a'), avis('b')], 14);
    expect(html).toContain('aria-label="Avis à traiter : 14"');
    expect(html).toContain('9+');
    expect(html).toContain(`href="${LIEN_FILE_A_TRAITER.replace('&', '&amp;')}"`);
    expect(html).toContain('Voir la file (14 avis)');
  });

  it('chaque avis ouvre sa fenêtre de traitement depuis la file', () => {
    const html = cloche([avis('f1')], 1);
    expect(html).toContain('href="/feedbacks?filtre=a-traiter&amp;avis=f1"');
    expect(html).toContain('Avis f1');
  });

  it('un avis sans prise en charge depuis plus de 48 h est marqué par un trait ET dit en texte', () => {
    const html = cloche([avis('vieux', { date_soumission: ilYA(60) }), avis('recent')], 2);
    expect((html.match(/is-late/g) || []).length).toBe(1);
    expect(html).toContain('sans prise en charge depuis plus de 48 h');
  });

  it('file vide : pas de pastille, message clair', () => {
    const html = cloche([], 0);
    expect(html).not.toContain('notif__count');
    expect(html).toContain('Aucun avis à traiter pour le moment.');
  });

  it('l’agence n’apparaît que dans la vue réseau', () => {
    expect(cloche([avis('a')], 1, true)).toContain('Agence A1');
    expect(cloche([avis('a')], 1, false)).not.toContain('Agence A1');
  });
});

describe('retard de prise en charge (48 h)', () => {
  it('seul un avis encore « nouveau » plus de 48 h après son dépôt est en retard', () => {
    expect(estEnRetard(avis('a', { date_soumission: ilYA(49) }), MAINTENANT)).toBe(true);
    expect(estEnRetard(avis('a', { date_soumission: ilYA(47) }), MAINTENANT)).toBe(false);
    expect(estEnRetard(avis('a', { date_soumission: ilYA(100), statut_traitement: 'en_traitement' }), MAINTENANT)).toBe(false);
    expect(estEnRetard(avis('a', { date_soumission: 'pas une date' }), MAINTENANT)).toBe(false);
  });
});

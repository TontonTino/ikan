import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AgenceSousSeuil } from '../../../types';
import { SiegeKpis } from './SiegeBlocks';
import { KpiDetail } from './SiegeDrawers';
import { normaliserAlertes, type AlertesSiege } from './siegeData';
import type { Source } from './useSiegeData';

const agence = (id: string, nom: string, taux: number, seuil: number, depuis48: boolean): AgenceSousSeuil => ({
  agence_id: id, agence_nom: nom, taux_actuel: taux, seuil, ecart_seuil: Math.round((seuil - taux) * 10) / 10, depuis_plus_de_48h: depuis48,
});
const PERSISTANTE = agence('a1', 'Alpha persistante', 25, 70, true);
const RECENTE = agence('a2', 'Beta récente', 33.3, 70, false);

const liste = (sousSeuil: AgenceSousSeuil[]) =>
  renderToStaticMarkup(
    <StaticRouter location="/siege">
      <KpiDetail kind="seuil" ranking={[]} sousSeuil={sousSeuil} seuils={new Map()} jours={30} onOpenAgence={vi.fn()} />
    </StaticRouter>,
  );

const compteur = (alertes: Source<AlertesSiege>) =>
  renderToStaticMarkup(
    <StaticRouter location="/siege">
      <SiegeKpis stats={{ status: 'loading' }} alertes={alertes} nbAgences={3} jours={30} onOpen={vi.fn()} />
    </StaticRouter>,
  );

describe('liste « Agences sous leur seuil » (CX-06)', () => {
  it('une ligne par agence : nom, satisfaction, seuil, écart en points et lien vers le détail', () => {
    const html = liste([PERSISTANTE, RECENTE]);
    expect(html).toContain('Alpha persistante');
    expect(html).toContain('25 %');
    expect(html).toContain('70 %');
    expect(html).toContain('−45 pts');
    expect(html).toContain('−36.7 pts');
    expect(html).toContain('href="/agences/a1/apercu"');
    expect(html).toContain('href="/agences/a2/apercu"');
    expect(html).toContain('aria-label="Voir l’agence Alpha persistante"');
  });

  it('le badge « Depuis plus de 48 h » n’apparaît que pour l’agence concernée', () => {
    const html = liste([PERSISTANTE, RECENTE]);
    expect(html.split('Depuis plus de 48 h').length - 1).toBe(2); // une fois dans la règle expliquée, une fois dans le badge
    expect(html.match(/ui-badge ui-badge--critical">Depuis plus de 48 h</g)).toHaveLength(1);
    const ligneRecente = html.slice(html.indexOf('Beta récente'), html.indexOf('href="/agences/a2/apercu"'));
    expect(ligneRecente).not.toContain('ui-badge');
    expect(liste([RECENTE])).not.toContain('ui-badge--critical');
  });

  it('l’ordre du serveur (la plus en difficulté d’abord) est conservé', () => {
    const html = liste([PERSISTANTE, RECENTE]);
    expect(html.indexOf('Alpha persistante')).toBeLessThan(html.indexOf('Beta récente'));
    const inverse = liste([RECENTE, PERSISTANTE]);
    expect(inverse.indexOf('Beta récente')).toBeLessThan(inverse.indexOf('Alpha persistante'));
  });

  it('état vide : « Aucune agence sous son seuil »', () => {
    const html = liste([]);
    expect(html).toContain('Aucune agence sous son seuil');
    expect(html).not.toContain('<tbody><tr');
  });

  it('la règle est expliquée en toutes lettres', () => {
    const html = liste([PERSISTANTE]);
    expect(html).toContain('satisfaction des 7 derniers jours (au moins 3 avis)');
    expect(html).toContain('Le badge « Depuis plus de 48 h » signale celles qui déclenchent une alerte');
  });
});

describe('compteur cliquable', () => {
  it('compte les agences ACTUELLEMENT sous leur seuil (pas seulement celles à 48 h) et ouvre le détail', () => {
    const html = compteur({ status: 'ok', data: { items: [], incluses: true, sousSeuil: [PERSISTANTE, RECENTE] } });
    expect(html).toContain('<div class="ui-kpi__value">2</div>');
    expect(html).toContain('aria-label="Agences sous leur seuil : 2. Voir le détail"');
  });

  it('aucune agence sous son seuil : 0 est un vrai résultat', () => {
    expect(compteur({ status: 'ok', data: { items: [], incluses: true, sousSeuil: [] } })).toContain('<div class="ui-kpi__value">0</div>');
  });

  it('forfait sans alertes : « Non inclus dans votre forfait », jamais 0, pas de détail à ouvrir', () => {
    const html = compteur({ status: 'ok', data: { items: [], incluses: false, sousSeuil: [] } });
    expect(html).toContain('Non inclus dans votre forfait');
    expect(html).not.toContain('<div class="ui-kpi__value">0</div>');
    expect(html).not.toContain('Voir le détail"');
  });

  it('chargement et erreur : inchangés', () => {
    expect(compteur({ status: 'loading' })).toContain('aria-busy');
    expect(compteur({ status: 'error' })).toContain('Alertes indisponibles');
  });
});

describe('données du serveur', () => {
  it('le champ agences_sous_seuil est repris tel quel (ordre compris)', () => {
    const donnees = normaliserAlertes({ alertes_seuil: [], alertes_incluses: true, agences_sous_seuil: [PERSISTANTE, RECENTE] });
    expect(donnees.sousSeuil).toEqual([PERSISTANTE, RECENTE]);
  });

  it('ancien serveur sans le champ : repli sur les alertes à 48 h, toutes « depuis plus de 48 h »', () => {
    const donnees = normaliserAlertes({ alertes_seuil: [{ agence_id: 'a9', agence_nom: 'Neuf', taux_actuel: 50, seuil: 70, message: '', ecart_seuil: 20 }] });
    expect(donnees.sousSeuil).toEqual([expect.objectContaining({ agence_id: 'a9', ecart_seuil: 20, depuis_plus_de_48h: true })]);
  });
});

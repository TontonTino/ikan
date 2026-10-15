import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Alerte } from '../../../types';
import { SiegeKpis, Surveillance } from './SiegeBlocks';
import { normaliserAlertes, type AlertesSiege } from './siegeData';
import type { Source } from './useSiegeData';

const alerte = (id: string): Alerte => ({ agence_id: id, agence_nom: `Agence ${id}`, taux_actuel: 50, seuil: 70, message: 'sous le seuil' });
const ok = (items: Alerte[], incluses: boolean): Source<AlertesSiege> => ({ status: 'ok', data: { items, incluses } });

const kpis = (alertes: Source<AlertesSiege>) =>
  renderToStaticMarkup(
    <StaticRouter location="/siege">
      <SiegeKpis stats={{ status: 'loading' }} alertes={alertes} nbAgences={3} jours={30} onOpen={vi.fn()} />
    </StaticRouter>,
  );

const surveillance = (alertesIncluses?: boolean) =>
  renderToStaticMarkup(
    <StaticRouter location="/siege">
      <Surveillance
        lignes={[]}
        total={0}
        loading={false}
        sourcesIndisponibles={[]}
        toutesIndisponibles={false}
        {...(alertesIncluses === undefined ? {} : { alertesIncluses })}
        onRetry={vi.fn()}
        onOpenAgence={vi.fn()}
      />
    </StaticRouter>,
  );

describe('normaliserAlertes — alertes_incluses de GET /alertes', () => {
  it('absent ou vrai : incluses (valeur par défaut inchangée)', () => {
    expect(normaliserAlertes({ alertes_seuil: [alerte('a1')] })).toEqual({ items: [alerte('a1')], incluses: true });
    expect(normaliserAlertes({ alertes_seuil: [], alertes_incluses: true }).incluses).toBe(true);
    expect(normaliserAlertes(undefined)).toEqual({ items: [], incluses: true });
  });

  it('faux : non incluses, la liste vide ne veut pas dire « aucune alerte »', () => {
    expect(normaliserAlertes({ alertes_seuil: [], alertes_incluses: false })).toEqual({ items: [], incluses: false });
  });
});

describe('siège — compteur « Agences sous leur seuil »', () => {
  it('alertes incluses : le compteur affiche le nombre réel et le périmètre', () => {
    const html = kpis(ok([alerte('a1'), alerte('a2')], true));
    expect(html).toContain('Agences sous leur seuil');
    expect(html).toContain('sur 3 agences');
    expect(html).not.toContain('Non inclus dans votre forfait');
  });

  it('alertes incluses mais aucune agence concernée : 0 est affiché (c’est une vraie information)', () => {
    const html = kpis(ok([], true));
    expect(html).toContain('sur 3 agences');
    expect(html).not.toContain('Non inclus dans votre forfait');
  });

  it('alertes non incluses : jamais « 0 », un libellé explicite à la place', () => {
    const html = kpis(ok([], false));
    expect(html).toContain('Non inclus dans votre forfait');
    expect(html).not.toContain('sur 3 agences');
  });

  it('chargement et erreur : inchangés', () => {
    expect(kpis({ status: 'loading' })).toContain('aria-busy');
    expect(kpis({ status: 'error' })).toContain('Alertes indisponibles');
  });
});

describe('siège — bloc « À surveiller »', () => {
  it('par défaut (prop absente) et alertes incluses : message habituel', () => {
    for (const html of [surveillance(), surveillance(true)]) {
      expect(html).toContain('Aucune agence sous son seuil, sans avis critique');
      expect(html).not.toContain('ne sont pas incluses dans votre forfait');
    }
  });

  it('alertes non incluses : l’absence de signal n’affirme pas qu’aucune agence n’est sous son seuil', () => {
    const html = surveillance(false);
    expect(html).toContain('Les alertes de seuil ne sont pas incluses dans votre forfait');
    expect(html).not.toContain('Aucune agence sous son seuil');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Chart from '../components/ui/Chart';
import GraphiqueVide from '../components/ui/GraphiqueVide';
import SatisfactionVolumeChart from '../components/stats/SatisfactionVolumeChart';
import SatisfactionEvolutionChart from '../components/stats/SatisfactionEvolutionChart';
import { elargirPeriode, periodePlusLarge } from './periodeElargie';

const OPTIONS = [{ jours: 7, label: '7 jours' }, { jours: 30, label: '30 jours' }, { jours: 90, label: '90 jours' }, { jours: 365, label: '12 mois' }];

describe('période plus large proposée par un graphique vide', () => {
  it('la période immédiatement supérieure parmi celles de la page, quel que soit leur ordre', () => {
    expect(periodePlusLarge(7, OPTIONS)?.jours).toBe(30);
    expect(periodePlusLarge(90, [...OPTIONS].reverse())?.label).toBe('12 mois');
    expect(periodePlusLarge(365, OPTIONS)).toBeNull();
  });

  it('libellé du lien et changement de période au clic', () => {
    const choisir = vi.fn();
    const lien = elargirPeriode(30, OPTIONS, choisir);
    expect(lien?.label).toBe('Voir sur 90 jours');
    lien?.onClick();
    expect(choisir).toHaveBeenCalledWith(90);
    expect(elargirPeriode(365, OPTIONS, choisir)).toBeUndefined();
  });
});

describe('graphique vide : une phrase et un lien, pas un cadre de pleine hauteur', () => {
  it('GraphiqueVide : phrase, puis bouton-lien seulement si une période plus large existe', () => {
    const avec = renderToStaticMarkup(<GraphiqueVide message="Aucun avis sur cette période." elargir={{ label: 'Voir sur 30 jours', onClick: () => {} }} />);
    expect(avec).toContain('Aucun avis sur cette période.');
    expect(avec).toMatch(/<button type="button" class="ui-graphique-vide__lien">Voir sur 30 jours<\/button>/);
    expect(renderToStaticMarkup(<GraphiqueVide message="Rien." />)).not.toContain('<button');
  });

  it('Chart vide : aucune hauteur réservée, lien transmis', () => {
    const html = renderToStaticMarkup(
      <Chart title="Évolution" height={380} isEmpty emptyTitle="Aucun avis sur cette période." emptyAction={{ label: 'Voir sur 30 jours', onClick: () => {} }}>
        {() => null}
      </Chart>,
    );
    expect(html).toContain('ui-graphique-vide');
    expect(html).toContain('Voir sur 30 jours');
    expect(html).not.toContain('height:380px');
  });

  it('statistiques : les deux courbes vides suivent la même règle', () => {
    const elargir = { label: 'Voir sur 90 jours', onClick: () => {} };
    for (const html of [
      renderToStaticMarkup(<SatisfactionVolumeChart satisfaction={[]} volume={[]} height={440} elargir={elargir} />),
      renderToStaticMarkup(<SatisfactionEvolutionChart data={[]} height={260} elargir={elargir} />),
    ]) {
      expect(html).toContain('ui-graphique-vide');
      expect(html).toContain('Voir sur 90 jours');
      expect(html).not.toMatch(/height:\s?(440|260)px/);
    }
  });
});

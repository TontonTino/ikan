import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import EtatListeAvis from './EtatListeAvis';

const rendu = (surcharge: Partial<React.ComponentProps<typeof EtatListeAvis>> = {}) =>
  renderToStaticMarkup(<EtatListeAvis chargement={false} erreur={false} total={0} filtresActifs={false} onReessayer={vi.fn()} onReinitialiser={vi.fn()} {...surcharge} />);

describe('liste des avis — les états', () => {
  it('chargement : indicateur accessible, ni liste ni message vide', () => {
    const html = rendu({ chargement: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement des avis');
    expect(html).not.toContain('Aucun avis');
  });

  it('aucun résultat avec filtres : message dédié et bouton de réinitialisation', () => {
    const html = rendu({ filtresActifs: true });
    expect(html).toContain('Aucun avis ne correspond à ces critères.');
    expect(html).toContain('Réinitialiser les filtres');
  });

  it('aucun avis du tout (sans filtre) : message de périmètre, pas de réinitialisation', () => {
    const html = rendu();
    expect(html).toContain('Aucun avis dans ce périmètre');
    expect(html).not.toContain('Réinitialiser');
  });

  it('erreur : message d’erreur et nouvel essai, jamais « aucun avis »', () => {
    const html = rendu({ erreur: true, filtresActifs: true });
    expect(html).toContain('Impossible de charger les avis');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Aucun avis ne correspond');
  });

  it('des résultats : rien à afficher', () => {
    expect(rendu({ total: 12, filtresActifs: true })).toBe('');
  });
});

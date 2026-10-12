import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PriseEnChargeBanner from './PriseEnChargeBanner';

const rendu = (statut: Parameters<typeof PriseEnChargeBanner>[0]['statut'], role: Parameters<typeof PriseEnChargeBanner>[0]['role']) =>
  renderToStaticMarkup(<PriseEnChargeBanner statut={statut} role={role} chargement={false} onPrendreEnCharge={vi.fn()} />);

describe('prise en charge explicite', () => {
  it('Responsable d’agence, avis nouveau : action « Prendre en charge » et rappel que consulter ne modifie rien', () => {
    const html = rendu('nouveau', 'agency_manager');
    expect(html).toContain('Prendre en charge');
    expect(html).toContain('Le consulter ne le modifie pas');
    expect(html).toContain('<button');
  });

  it('CX Manager, avis nouveau : information seulement, aucune action', () => {
    const html = rendu('nouveau', 'cx_manager');
    expect(html).toContain('pas encore été pris en charge');
    expect(html).not.toContain('<button');
  });

  it('administrateur ou rôle inconnu : aucune action', () => {
    expect(rendu('nouveau', 'admin')).not.toContain('<button');
    expect(rendu('nouveau', undefined)).not.toContain('<button');
  });

  it.each(['en_traitement', 'en_cours', 'resolu'] as const)('avis %s : rien à afficher', (statut) => {
    expect(rendu(statut, 'agency_manager')).toBe('');
  });
});

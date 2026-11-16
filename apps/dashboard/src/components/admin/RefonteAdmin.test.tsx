import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChiffresCles from './ChiffresCles';
import RepartitionForfaitsCard from './RepartitionForfaitsCard';
import PageHeader from '../ui/PageHeader';

describe('compte administrateur : en-têtes et chiffres', () => {
  it('l’en-tête historique rend le même titre léger que les autres pages : un seul h1, sans carte ni date en surtitre', () => {
    const html = renderToStaticMarkup(<PageHeader title="Facturation" subtitle="Forfaits et paiements." onExport={vi.fn()} primaryAction={{ label: 'Nouvelle organisation', onClick: vi.fn() }} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('ui-page-title');
    expect(html).not.toContain('page-header-shell');
    expect(html).not.toMatch(/(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d/i);
    // Une seule action principale ; Exporter reste secondaire.
    expect(html.match(/ui-btn--primary/g)).toHaveLength(1);
    expect(html).toContain('ui-btn--secondary');
  });

  it('chiffres clés : une carte, une cellule par chiffre, nombres au format français', () => {
    const html = renderToStaticMarkup(<ChiffresCles label="Structure" items={[{ label: 'Agences', valeur: 1250, note: 'enregistrées' }, { label: 'Taux', valeur: '—' }]} />);
    expect(html.match(/chiffres-cles__cellule/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Structure"');
    expect(html).toMatch(/1\s250/);
    expect(html).toContain('—');
  });

  it('répartition par forfait : total accordé, forfaits à zéro listés en retrait', () => {
    const html = renderToStaticMarkup(<RepartitionForfaitsCard repartition={[{ code: 'gratuit', nom: 'Gratuit', nombre: 0 }, { code: 'entreprise', nom: 'Entreprise', nombre: 1 }] as never} />);
    expect(html).toContain('1 organisation active');
    expect(html).toContain('repartition-forfaits__vide');
  });
});

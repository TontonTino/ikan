import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Recommandation, RecommandationsAgenceGroupe } from '../../types';
import AgencyRecommendations from './AgencyRecommendations';
import { GroupeAgence, libelleNombre } from './RecommandationsParAgence';
import { libelleEvenementAgence } from '../../utils/vocabulaire';

const reco = (id: string, contenu: string): Recommandation => ({
  id, analyse_ia_id: 'a', contenu, priorite: 'high' as Recommandation['priorite'], date_generation: '2026-10-01T10:00:00Z', traitee: false, source: 'regles' as Recommandation['source'],
});
const groupe = (extra: Partial<RecommandationsAgenceGroupe> = {}): RecommandationsAgenceGroupe => ({
  agence_id: 'g1', agence_nom: 'Agence Lyon', nombre: 2, plus_ancienne: '2026-09-20T08:00:00Z', recommandations: [reco('r1', 'Renforcer l’accueil'), reco('r2', 'Réduire l’attente')], ...extra,
});
const rendu = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('recommandations regroupées par agence (CX-09)', () => {
  it('en-tête : nom, nombre à traiter et la plus ancienne ; dépliable vers les recommandations', () => {
    const html = rendu(<GroupeAgence groupe={groupe()} traitee={false} onChangerStatut={vi.fn()} occupee={null} />);
    expect(html).toContain('<details');
    expect(html).toContain('Agence Lyon');
    expect(html).toContain('2 à traiter');
    expect(html).toContain('la plus ancienne');
    expect(html).toContain('Renforcer l’accueil');
    expect(html).toContain('Marquer comme traitée');
    expect(html).not.toContain('Remettre à traiter');
  });

  it('état « traitées » : le bouton remet à traiter (retour possible)', () => {
    const html = rendu(<GroupeAgence groupe={groupe()} traitee onChangerStatut={vi.fn()} occupee={null} />);
    expect(html).toContain('2 traitées');
    expect(html).toContain('Remettre à traiter');
    expect(html).not.toContain('Marquer comme traitée');
  });

  it('plus de recommandations que celles affichées : le reste est signalé', () => {
    const html = rendu(<GroupeAgence groupe={groupe({ nombre: 25 })} traitee={false} onChangerStatut={vi.fn()} occupee={null} />);
    expect(html).toContain('23 autres non affichées');
  });

  it('pluriel du libellé', () => {
    expect(libelleNombre(1, false)).toBe('1 à traiter');
    expect(libelleNombre(1, true)).toBe('1 traitée');
    expect(libelleNombre(3, true)).toBe('3 traitées');
  });

  it('historique : les nouveaux événements ont un libellé français', () => {
    expect(libelleEvenementAgence('recommandation_traitee')).toBe('Recommandation traitée');
    expect(libelleEvenementAgence('recommandation_rouverte')).toBe('Recommandation remise à traiter');
  });
});

describe('bascule « Vue à plat / Par agence »', () => {
  const props = { recos: [reco('r1', 'Renforcer l’accueil')], total: 1, loadFailed: false, loading: false, loadingMore: false, actionsEnCours: 0, onMarquerTraitee: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn() };

  it('sans vue groupée (Responsable d’agence) : aucune bascule, vue à plat inchangée', () => {
    const html = rendu(<AgencyRecommendations {...props} />);
    expect(html).not.toContain('Par agence');
    expect(html).toContain('Renforcer l’accueil');
    expect(html).toContain('Marquer comme traitée');
  });

  it('avec vue groupée : bascule visible, la vue à plat reste celle affichée par défaut', () => {
    const html = rendu(<AgencyRecommendations {...props} vueGroupee={<div>VUE-GROUPEE</div>} />);
    expect(html).toContain('Vue à plat');
    expect(html).toContain('Par agence');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Renforcer l’accueil');
    expect(html).not.toContain('VUE-GROUPEE');
  });
});

import { describe, expect, it } from 'vitest';
import { lienApercuAgence, lienAvis, lienAvisReseau } from './liensAgence';
import { ROUTE_ROLES, redirectionRole } from '../components/layout/navigation';

const AGENCE = 'ddd32d67-3efa-480f-a6cc-4f88eabd8f79';

describe('liens vers les avis', () => {
  it('CX Manager avec agence connue : ouvre l’aperçu de CETTE agence, onglet Avis', () => {
    expect(lienAvis('cx_manager', AGENCE)).toBe(`/agences/${AGENCE}/apercu?tab=feedbacks`);
    expect(lienAvis('cx_manager', AGENCE, 'critiques')).toBe(`/agences/${AGENCE}/apercu?tab=feedbacks`);
  });

  it('CX Manager sans agence connue : liste réseau, sans contexte inventé', () => {
    expect(lienAvis('cx_manager', undefined)).toBe('/feedbacks');
    expect(lienAvis('cx_manager', null, 'critiques')).toBe('/feedbacks?tab=critiques');
  });

  it('Responsable d’agence : sa liste d’avis, onglet conservé, jamais l’aperçu CX', () => {
    expect(lienAvis('agency_manager', AGENCE)).toBe('/feedbacks');
    expect(lienAvis('agency_manager', AGENCE, 'a_traiter')).toBe('/feedbacks?tab=a_traiter');
  });

  it('rôle inconnu ou administrateur : aucun lien vers un aperçu d’agence', () => {
    expect(lienAvis(undefined, AGENCE)).toBe('/feedbacks');
    expect(lienAvis('admin', AGENCE)).toBe('/feedbacks');
  });

  it('l’identifiant est encodé dans le chemin', () => {
    expect(lienApercuAgence('a/b?c')).toBe('/agences/a%2Fb%3Fc/apercu');
    expect(lienApercuAgence(AGENCE, 'rappels')).toBe(`/agences/${AGENCE}/apercu?tab=rappels`);
  });
});

describe('routes liées à l’agence', () => {
  it('l’aperçu d’agence reste ouvert aux deux rôles managers, fermé à l’administrateur', () => {
    expect(redirectionRole('cx_manager', '/agences/:agenceId/apercu')).toBeNull();
    expect(redirectionRole('agency_manager', '/agences/:agenceId/apercu')).toBeNull();
    expect(redirectionRole('admin', '/agences/:agenceId/apercu')).toBe('/admin/dashboard');
  });

  it('/mon-agence : règle de rôle inchangée (le cas du CX sans agence est traité dans la page)', () => {
    expect(ROUTE_ROLES['/mon-agence']).toEqual(['cx_manager', 'agency_manager']);
  });

  it('/feedbacks, /suggestions et /demandes-rappel : inchangées pour les deux rôles managers', () => {
    for (const route of ['/feedbacks', '/suggestions', '/demandes-rappel']) {
      expect(ROUTE_ROLES[route]).toEqual(['cx_manager', 'agency_manager']);
      expect(redirectionRole('admin', route)).toBe('/admin/dashboard');
    }
  });
});

describe('contexte de navigation conservé dans les liens', () => {
  const AVIS = '3f2b8c1e-5d4a-4b6f-9a1c-0e7d2b9f4a11';

  it('avis ciblé : transmis à l’aperçu (CX) et à la liste (Responsable)', () => {
    expect(lienAvis('cx_manager', AGENCE, undefined, { avisId: AVIS })).toBe(`/agences/${AGENCE}/apercu?tab=feedbacks&avis=${AVIS}`);
    expect(lienAvis('agency_manager', AGENCE, 'critiques', { avisId: AVIS })).toBe(`/feedbacks?tab=critiques&avis=${AVIS}`);
  });

  it('thème et période transmis, valeurs absentes omises', () => {
    expect(lienAvisReseau({ theme: 'attente', jours: 30 })).toBe('/feedbacks?theme=attente&jours=30');
    expect(lienAvisReseau({ agenceId: AGENCE, jours: 7 })).toBe(`/feedbacks?agence=${AGENCE}&jours=7`);
    expect(lienAvisReseau({ onglet: 'critiques', jours: 90 })).toBe('/feedbacks?tab=critiques&jours=90');
    expect(lienAvisReseau()).toBe('/feedbacks');
    expect(lienAvisReseau({ theme: null, jours: null })).toBe('/feedbacks');
  });

  it('un thème libre est encodé', () => {
    expect(lienAvisReseau({ theme: 'accueil & attente' })).toBe('/feedbacks?theme=accueil+%26+attente');
  });
});

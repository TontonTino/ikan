import { describe, expect, it } from 'vitest';
import { RAYON_REGROUPEMENT_PX, positionsIdentiques, regrouper, resumeGroupe } from './regroupement';
import sourceCarte from './AgencesMap.tsx?raw';
import { STATUT_SEUIL_LABEL } from '../../pages/cx/siege/siegeData';

const p = (id: string, x: number, y: number) => ({ id, x, y });

describe('regroupement des marqueurs proches (lot 6)', () => {
  it('des marqueurs superposés forment un groupe ; un marqueur éloigné reste seul', () => {
    const groupes = regrouper([p('ouaga1', 500, 300), p('ouaga2', 510, 305), p('saaba', 530, 300), p('bobo', 100, 600)]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0].membres.map((m) => m.id)).toEqual(['ouaga1', 'ouaga2', 'saaba']);
    expect(groupes[1].membres.map((m) => m.id)).toEqual(['bobo']);
  });

  it('le centre du groupe est la moyenne de ses membres', () => {
    const [g] = regrouper([p('a', 0, 0), p('b', 10, 0), p('c', 20, 0)]);
    expect(g.x).toBeCloseTo(10);
    expect(g.y).toBeCloseTo(0);
  });

  it('au-delà du rayon, deux marqueurs restent séparés (un zoom suffit à défaire un groupe)', () => {
    expect(regrouper([p('a', 0, 0), p('b', RAYON_REGROUPEMENT_PX + 1, 0)])).toHaveLength(2);
    expect(regrouper([p('a', 0, 0), p('b', RAYON_REGROUPEMENT_PX - 1, 0)])).toHaveLength(1);
  });

  it('stable : même entrée, mêmes groupes ; liste vide : aucun groupe', () => {
    const points = [p('a', 0, 0), p('b', 5, 5), p('c', 300, 300)];
    expect(regrouper(points)).toEqual(regrouper(points));
    expect(regrouper([])).toEqual([]);
  });

  it('positions identiques : aucun zoom ne les séparerait', () => {
    expect(positionsIdentiques([{ latitude: 12.37, longitude: -1.52 }, { latitude: 12.37, longitude: -1.52 }])).toBe(true);
    expect(positionsIdentiques([{ latitude: 12.37, longitude: -1.52 }, { latitude: 12.38, longitude: -1.52 }])).toBe(false);
  });

  it('le contenu d’un groupe se dit en texte (title du marqueur), pas seulement par la couleur', () => {
    expect(resumeGroupe(['sous', 'sous', 'au_dessus'], STATUT_SEUIL_LABEL)).toBe('3 agences : 2 sous le seuil, 1 au-dessus du seuil');
  });

  it('câblage : la carte regroupe, recalcule au zoom, zoome au clic, et sans nouvelle dépendance', () => {
    expect(sourceCarte).toContain('<MarqueursRegroupes agences={agences} onVoirAgence={onVoirAgence} />');
    expect(sourceCarte).toContain('zoomend: () => setGroupes(calculer())');
    expect(sourceCarte).toContain('map.fitBounds(L.latLngBounds(');
    expect(sourceCarte).not.toMatch(/markercluster/i);
  });
});

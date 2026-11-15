import { describe, expect, it } from 'vitest';
import { VILLE_INCONNUE, agenceAffichee, agencesParVille, nombreAgences } from './perimetre';

const A = (id: string, nom: string, ville: string | null) => ({ id, nom, ville });
const AGENCES = [
  A('1', 'Agence Orange Pissy', 'Ouagadougou'),
  A('2', 'Agence Orange Bobo-Dioulasso', 'Bobo-Dioulasso'),
  A('3', 'Agence Orange Ouaga 2000', 'Ouagadougou'),
  A('4', 'Agence Orange Koupéla', 'Koupéla'),
  A('5', 'Agence sans ville', null),
];

describe('agences regroupées par ville', () => {
  it('villes puis agences par ordre alphabétique ; la ville inconnue en dernier', () => {
    const groupes = agencesParVille(AGENCES);
    expect(groupes.map((g) => g.ville)).toEqual(['Bobo-Dioulasso', 'Koupéla', 'Ouagadougou', VILLE_INCONNUE]);
    expect(groupes[2].agences.map((a) => a.nom)).toEqual(['Agence Orange Ouaga 2000', 'Agence Orange Pissy']);
  });

  it('recherche sans accents ni majuscules, sur le nom ou la ville', () => {
    expect(agencesParVille(AGENCES, 'koupela').flatMap((g) => g.agences.map((a) => a.id))).toEqual(['4']);
    expect(agencesParVille(AGENCES, 'OUAGADOUGOU').flatMap((g) => g.agences.map((a) => a.id))).toEqual(['3', '1']);
    expect(agencesParVille(AGENCES, '  pissy ').flatMap((g) => g.agences.map((a) => a.id))).toEqual(['1']);
    expect(agencesParVille(AGENCES, 'zzz')).toEqual([]);
  });
});

describe('agence affichée et libellés', () => {
  it('lit l’agence dans l’adresse de son aperçu, sinon la vue réseau', () => {
    expect(agenceAffichee('/agences/abc-123/apercu')).toBe('abc-123');
    expect(agenceAffichee('/agences/abc-123/apercu?tab=categories')).toBe('abc-123');
    expect(agenceAffichee('/siege')).toBeNull();
  });

  it('accorde le nombre d’agences', () => {
    expect(nombreAgences(1)).toBe('1 agence');
    expect(nombreAgences(11)).toBe('11 agences');
  });
});

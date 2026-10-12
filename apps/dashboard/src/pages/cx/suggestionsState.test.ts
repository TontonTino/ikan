import { describe, expect, it } from 'vitest';
import type { Suggestion } from '../../types';
import { SUGGESTIONS_INITIAL, parametresSuggestions, suggestionsReducer, totalAnnonce } from './suggestionsState';
import { parametresDemandes } from '../agency/demandesRappelParams';

const idee = (id: string): Suggestion => ({ id, contenu: `idée ${id}`, statut: 'nouveau', date_soumission: '2026-10-10T10:00:00Z' } as Suggestion);

describe('état des suggestions', () => {
  it('démarre en chargement', () => {
    expect(SUGGESTIONS_INITIAL.statut).toBe('chargement');
  });

  it('succès sans suggestion : véritable liste vide, pas une erreur', () => {
    const etat = suggestionsReducer(SUGGESTIONS_INITIAL, { type: 'succes', donnees: [], total: 0 });
    expect(etat).toEqual({ statut: 'pret', donnees: [], total: 0 });
  });

  it('succès avec suggestions', () => {
    const etat = suggestionsReducer(SUGGESTIONS_INITIAL, { type: 'succes', donnees: [idee('a'), idee('b')], total: 2 });
    expect(etat.statut).toBe('pret');
    expect(etat.donnees).toHaveLength(2);
  });

  it('échec au premier chargement : état d’erreur, jamais « prêt avec liste vide »', () => {
    const etat = suggestionsReducer(SUGGESTIONS_INITIAL, { type: 'echec' });
    expect(etat.statut).toBe('erreur');
    expect(etat.statut).not.toBe('pret');
  });

  it('réessai : chargement puis succès', () => {
    let etat = suggestionsReducer(SUGGESTIONS_INITIAL, { type: 'echec' });
    etat = suggestionsReducer(etat, { type: 'debut' });
    expect(etat.statut).toBe('chargement');
    etat = suggestionsReducer(etat, { type: 'succes', donnees: [idee('a')], total: 1 });
    expect(etat).toMatchObject({ statut: 'pret', total: 1 });
    expect(etat.donnees).toHaveLength(1);
  });

  it('un échec n’efface pas les données déjà chargées', () => {
    const charge = suggestionsReducer(SUGGESTIONS_INITIAL, { type: 'succes', donnees: [idee('a'), idee('b')], total: 2 });
    const apresEchec = suggestionsReducer(charge, { type: 'echec' });
    expect(apresEchec.statut).toBe('erreur');
    expect(apresEchec.donnees).toHaveLength(2);
    expect(apresEchec.total).toBe(2);
  });

  it('« charger plus » ajoute sans doublon', () => {
    const charge = suggestionsReducer(SUGGESTIONS_INITIAL, { type: 'succes', donnees: [idee('a'), idee('b')], total: 3 });
    const etat = suggestionsReducer(charge, { type: 'plus', donnees: [idee('b'), idee('c')] });
    expect(etat.donnees.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('un changement de statut ne touche que la suggestion visée', () => {
    const charge = suggestionsReducer(SUGGESTIONS_INITIAL, { type: 'succes', donnees: [idee('a'), idee('b')], total: 2 });
    const etat = suggestionsReducer(charge, { type: 'statut', id: 'b', statut: 'rejete' });
    expect(etat.donnees.map((s) => s.statut)).toEqual(['nouveau', 'rejete']);
  });

  it('total annoncé : en-tête du serveur, sinon nombre de lignes', () => {
    expect(totalAnnonce({ 'x-total-count': '81' }, 50)).toBe(81);
    expect(totalAnnonce({}, 7)).toBe(7);
    expect(totalAnnonce(undefined, 3)).toBe(3);
  });
});

describe('contexte d’agence transmis au serveur', () => {
  it('suggestions : l’identifiant de l’agence est envoyé tel quel', () => {
    expect(parametresSuggestions('agence-42', 0)).toEqual({ limit: 50, offset: 0, agence_id: 'agence-42' });
    expect(parametresSuggestions('agence-42', 50)).toMatchObject({ offset: 50, agence_id: 'agence-42' });
  });

  it('suggestions : sans contexte, aucun filtre d’agence n’est inventé', () => {
    expect(parametresSuggestions(undefined, 0)).toEqual({ limit: 50, offset: 0 });
  });

  it('demandes de rappel : l’identifiant de l’agence est envoyé, y compris pour « charger plus »', () => {
    expect(parametresDemandes(false, 'agence-42', 0)).toEqual({ traitee: false, limit: 50, offset: 0, agence_id: 'agence-42' });
    expect(parametresDemandes(true, 'agence-42', 50)).toEqual({ traitee: true, limit: 50, offset: 50, agence_id: 'agence-42' });
  });

  it('demandes de rappel : sans agence, aucun filtre n’est ajouté', () => {
    expect(parametresDemandes(false, null, 0)).toEqual({ traitee: false, limit: 50, offset: 0 });
    expect(parametresDemandes(false, undefined, 0)).not.toHaveProperty('agence_id');
  });
});

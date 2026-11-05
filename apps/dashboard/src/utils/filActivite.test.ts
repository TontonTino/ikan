import { describe, expect, it } from 'vitest';
import { AUTEUR_INCONNU, annonceChargement, libelleAuteur, libelleEvenement, libelleRole, libelleVoirPlus } from './filActivite';

const ev = (type_evenement: string, extra: Record<string, unknown> = {}) => ({ type_evenement, ancien_statut: null, nouveau_statut: null, details: null, ...extra }) as never;

describe('phrases du fil : seulement ce que la ligne contient', () => {
  it.each([
    ['creation', 'Problème enregistré'],
    ['feedback_rattache', 'Avis rattaché'],
    ['feedback_detache', 'Avis détaché'],
    ['feedback_deplace_entrant', 'Avis déplacé depuis un autre problème'],
    ['feedback_deplace_sortant', 'Avis déplacé vers un autre problème'],
    ['issue_resolue', 'Problème résolu : toutes les actions sont terminées'],
    ['issue_verifiee', 'Résolution confirmée'],
  ])('%s → « %s »', (type, texte) => {
    expect(libelleEvenement(ev(type))).toEqual({ texte, detail: null });
  });

  it('action définie et terminée : le titre vient de la ligne', () => {
    expect(libelleEvenement(ev('action_creee', { details: 'Réparer la climatisation', nouveau_statut: 'action_en_cours', ancien_statut: 'ouverte' }))).toEqual({ texte: 'Action définie', detail: 'Réparer la climatisation' });
    expect(libelleEvenement(ev('action_terminee', { details: ' Réparer ' }))).toEqual({ texte: 'Action terminée', detail: 'Réparer' });
  });

  it('action sans titre : pas de titre inventé', () => {
    expect(libelleEvenement(ev('action_creee')).detail).toBeNull();
    expect(libelleEvenement(ev('action_terminee', { details: '   ' })).detail).toBeNull();
  });

  it('réouverture : la ligne « vérifiée → rouverte » est dite « Problème rouvert », sans répéter le titre de l’action (la ligne suivante le porte)', () => {
    const l = libelleEvenement(ev('action_creee', { details: 'Contrôler à nouveau', ancien_statut: 'verifiee', nouveau_statut: 'reouverte' }));
    expect(l).toEqual({ texte: 'Problème rouvert : nouvelle action après la vérification', detail: null });
  });

  it('un avis qui rouvre un problème vérifié le dit', () => {
    expect(libelleEvenement(ev('feedback_rattache', { ancien_statut: 'verifiee', nouveau_statut: 'reouverte' })).texte).toBe('Avis rattaché : le problème est rouvert');
    expect(libelleEvenement(ev('feedback_deplace_entrant', { nouveau_statut: 'reouverte' })).texte).toContain('le problème est rouvert');
  });

  it('les autres événements n’exposent jamais de texte libre : details ignoré hors événements d’action', () => {
    for (const type of ['creation', 'feedback_rattache', 'feedback_deplace_entrant', 'issue_resolue', 'issue_verifiee']) {
      expect(libelleEvenement(ev(type, { details: 'Texte libre : avis du client 06 12 34 56 78' })).detail).toBeNull();
    }
  });

  it('type inconnu : « Autre événement », jamais le nom technique ni une phrase inventée', () => {
    const l = libelleEvenement(ev('truc_inattendu', { details: 'secret' }));
    expect(l).toEqual({ texte: 'Autre événement', detail: null });
    expect(JSON.stringify(l)).not.toContain('truc_inattendu');
  });
});

describe('auteur', () => {
  it('le nom tel que la base le donne', () => {
    expect(libelleAuteur({ auteur_nom: 'Awa Sawadogo' })).toBe('Awa Sawadogo');
    expect(libelleAuteur({ auteur_nom: '  Issouf Traoré ' })).toBe('Issouf Traoré');
  });

  it('inconnu : « Système », jamais un nom deviné', () => {
    for (const auteur_nom of [null, undefined, '', '   ']) expect(libelleAuteur({ auteur_nom })).toBe(AUTEUR_INCONNU);
    expect(AUTEUR_INCONNU).toBe('Système');
  });

  it('rôle lisible, ou rien', () => {
    expect(libelleRole({ auteur_role: 'cx_manager' })).toBe('CX Manager');
    expect(libelleRole({ auteur_role: 'agency_manager' })).toBe('Agency Manager');
    expect(libelleRole({ auteur_role: 'inconnu' })).toBeNull();
    expect(libelleRole({ auteur_role: null })).toBeNull();
  });
});

describe('« Voir plus » et annonces', () => {
  it('reste vrai : total du serveur moins ce qui est affiché ; rien s’il ne reste rien', () => {
    expect(libelleVoirPlus(10, 25)).toBe('Voir plus (15)');
    expect(libelleVoirPlus(25, 25)).toBeNull();
    expect(libelleVoirPlus(30, 25)).toBeNull();
  });

  it('annonce vocale du nombre ajouté', () => {
    expect(annonceChargement(0)).toBe('');
    expect(annonceChargement(1)).toBe('1 événement de plus affiché.');
    expect(annonceChargement(10)).toBe('10 événements de plus affichés.');
  });
});

import { describe, expect, it } from 'vitest';
import {
  CANAL_LABELS, CANAUX_REPONSE, canalApresBrouillon, decisionUtilisation, enregistrerTraiteLaDemande, estCanalConnu, texteDuBrouillon,
} from './brouillonReponse';
import type { EtatBrouillon } from './brouillonReponse';

const ok = (b: object): EtatBrouillon => ({ statut: 'ok', brouillon: { disponible: true, ...b } });

describe('canaux', () => {
  it('la liste est celle de l’API, « autre » s’affiche « Autre / sans contact »', () => {
    expect([...CANAUX_REPONSE]).toEqual(['telephone', 'whatsapp', 'email', 'sms', 'autre']);
    expect(CANAL_LABELS.autre).toBe('Autre / sans contact');
    expect(CANAUX_REPONSE.every((c) => CANAL_LABELS[c])).toBe(true);
  });
  it('estCanalConnu refuse tout ce qui n’est pas dans la liste', () => {
    expect(estCanalConnu('sms')).toBe(true);
    for (const v of ['fax', '', null, undefined, 3, 'Telephone']) expect(estCanalConnu(v)).toBe(false);
  });
  it('le canal suggéré inconnu ou absent laisse le canal courant', () => {
    expect(canalApresBrouillon('telephone', 'email')).toBe('email');
    expect(canalApresBrouillon('sms', 'fax')).toBe('sms');
    expect(canalApresBrouillon('sms', null)).toBe('sms');
    expect(canalApresBrouillon('sms', undefined)).toBe('sms');
  });
});

describe('texteDuBrouillon', () => {
  it('seul un brouillon disponible et non vide est proposé', () => {
    expect(texteDuBrouillon(ok({ texte: 'Bonjour' }))).toBe('Bonjour');
    expect(texteDuBrouillon({ statut: 'chargement' })).toBeNull();
    expect(texteDuBrouillon({ statut: 'erreur' })).toBeNull();
    expect(texteDuBrouillon({ statut: 'ok', brouillon: { disponible: false, raison: 'aucun_suivi', texte: null } })).toBeNull();
    expect(texteDuBrouillon({ statut: 'ok', brouillon: { disponible: false, raison: 'reponse_existante', texte: 'ne doit pas apparaître' } })).toBeNull();
    expect(texteDuBrouillon(ok({ texte: '   ' }))).toBeNull();
    expect(texteDuBrouillon(ok({ texte: null }))).toBeNull();
  });
});

describe('decisionUtilisation : jamais d’écrasement silencieux', () => {
  it('zone vide ou blanche : on applique', () => {
    expect(decisionUtilisation('', 'B')).toBe('appliquer');
    expect(decisionUtilisation('  \n ', 'B')).toBe('appliquer');
  });
  it('texte déjà saisi et différent : confirmation', () => {
    expect(decisionUtilisation('Mon texte', 'B')).toBe('confirmer');
  });
  it('déjà identique : rien à remplacer', () => {
    expect(decisionUtilisation('B', 'B')).toBe('deja_en_place');
  });
});

describe('avertissement AM-07', () => {
  it('seulement s’il existe une demande de rappel non traitée', () => {
    expect(enregistrerTraiteLaDemande({ traitee: false })).toBe(true);
    expect(enregistrerTraiteLaDemande({ traitee: true })).toBe(false);
    expect(enregistrerTraiteLaDemande(null)).toBe(false);
    expect(enregistrerTraiteLaDemande(undefined)).toBe(false);
  });
});

import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { messageRefusServeur } from './userFacingError';

const refus = (status: number, data: unknown) =>
  new AxiosError('refus', 'ERR_BAD_REQUEST', undefined, undefined, { status, data, statusText: '', headers: {}, config: {} as never } as AxiosResponse);

describe('messageRefusServeur', () => {
  it('reprend le texte français d’un refus 400 (e-mail déjà utilisé)', () => {
    expect(messageRefusServeur(refus(400, { detail: 'Email déjà utilisé' }))).toBe('Email déjà utilisé');
  });

  it('reprend le texte d’un refus 422 en texte simple (agence obligatoire)', () => {
    expect(messageRefusServeur(refus(422, { detail: 'Un compte responsable d’agence doit être rattaché à une agence de votre organisation.' })))
      .toContain('rattaché à une agence');
  });

  it('reprend le message d’une validation maison (seuil, mot de passe) et celui d’un champ obligatoire', () => {
    const seuil = { detail: [{ type: 'value_error', loc: ['body', 'seuil_alerte'], msg: 'Le seuil d’alerte doit être un nombre compris entre 0 et 100 %.' }] };
    expect(messageRefusServeur(refus(422, seuil))).toBe('Le seuil d’alerte doit être un nombre compris entre 0 et 100 %.');
    expect(messageRefusServeur(refus(422, { detail: [{ type: 'missing', loc: ['body', 'password'], msg: 'Ce champ est obligatoire.' }] })))
      .toBe('Ce champ est obligatoire.');
  });

  it('ignore une erreur de validation native (texte anglais), un autre statut et une erreur non HTTP', () => {
    expect(messageRefusServeur(refus(422, { detail: [{ type: 'float_parsing', msg: 'Input should be a valid number' }] }))).toBeNull();
    expect(messageRefusServeur(refus(500, { detail: 'Une erreur interne est survenue.' }))).toBeNull();
    expect(messageRefusServeur(refus(403, { detail: 'Accès refusé' }))).toBeNull();
    expect(messageRefusServeur(new Error('réseau'))).toBeNull();
  });

  it('ignore un message démesuré ou absent', () => {
    expect(messageRefusServeur(refus(400, { detail: 'x'.repeat(500) }))).toBeNull();
    expect(messageRefusServeur(refus(400, {}))).toBeNull();
  });
});

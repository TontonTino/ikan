import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { erreurNom, erreurRetention, refusParametres, type BornesParametres } from './parametresSysteme';

const BORNES: BornesParametres = { retention_mois: { min: 1, max: 120 }, nom_application: { max_caracteres: 255 } };

const refus = (status: number, data: unknown) =>
  new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { status, data } as AxiosResponse);

describe('contrôle de saisie de la durée de conservation (mêmes bornes que le serveur)', () => {
  it.each(['1', '24', '120', ' 12 '])('accepte %s', (v) => expect(erreurRetention(v, BORNES)).toBeNull());
  it.each(['0', '121', '-5', '12.5', '12,5', 'abc', '', ' ', '1e3', '٣', '99999999999999999999'])('refuse %s', (v) => {
    expect(erreurRetention(v, BORNES)).toMatch(/entier|entre 1 et 120/);
  });
  it('les bornes viennent de l’API : changer les bornes change le contrôle, sans valeur en dur', () => {
    expect(erreurRetention('50', { retention_mois: { min: 1, max: 36 } })).toMatch(/entre 1 et 36/);
    expect(erreurRetention('50', undefined)).toBeNull();
    expect(erreurRetention('abc', undefined)).toMatch(/entier/);
  });
});

describe('contrôle du nom', () => {
  it('refuse vide ou trop long', () => {
    expect(erreurNom('   ', BORNES)).toMatch(/Saisissez/);
    expect(erreurNom('a'.repeat(256), BORNES)).toMatch(/255/);
    expect(erreurNom('a'.repeat(255), BORNES)).toBeNull();
  });
});

describe('lecture du refus 422', () => {
  it('reprend le message français et le champ fautif', () => {
    const e = refus(422, { detail: [{ type: 'value_error', loc: ['body', 'retention_mois'], msg: 'La durée de conservation doit être un nombre entier de mois, de 1 à 120.' }] });
    expect(refusParametres(e)).toEqual({ champ: 'retention_mois', message: 'La durée de conservation doit être un nombre entier de mois, de 1 à 120.' });
  });
  it('champ inconnu : message sans champ', () => {
    const e = refus(422, { detail: [{ type: 'value_error', loc: ['body'], msg: 'Paramètre inconnu : x.' }] });
    expect(refusParametres(e)).toEqual({ champ: null, message: 'Paramètre inconnu : x.' });
  });
  it('autres erreurs : null (le message générique prend le relais)', () => {
    expect(refusParametres(refus(500, { detail: 'boom' }))).toBeNull();
    expect(refusParametres(refus(422, { detail: [{ type: 'string_type', loc: ['body'], msg: 'Input should be a valid string' }] }))).toBeNull();
    expect(refusParametres(new Error('x'))).toBeNull();
  });
});

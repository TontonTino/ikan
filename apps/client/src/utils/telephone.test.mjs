import test from 'node:test';
import assert from 'node:assert/strict';
import { formaterSaisieTelephone, normaliserTelephone, telephoneInternational } from './telephone.ts';

test('formats internationaux valides -> chiffres sans signe +', () => {
  for (const [saisie, attendu] of [
    ['+226 70 12 34 56', '22670123456'],
    ['0022670123456', '22670123456'],
    ['+33 6 12 34 56 78', '33612345678'],
    ['+1 (202) 555-0123', '12025550123'],
    ['+12345678', '12345678'],
    ['+123456789012345', '123456789012345'],
  ]) assert.equal(normaliserTelephone(saisie), attendu, saisie);
});

test('8 chiffres (avec ou sans espaces) : numéro burkinabè, l\'indicatif +226 est celui affiché devant le champ', () => {
  for (const saisie of ['70 12 34 56', '70123456', '70.12.34.56', ' 05 12 34 56 ']) {
    assert.equal(normaliserTelephone(saisie), '226' + saisie.replace(/\D/g, ''), saisie);
  }
  assert.equal(telephoneInternational('70 12 34 56'), '+22670123456');
  assert.equal(telephoneInternational('00226 70 12 34 56'), '+22670123456');
  assert.equal(telephoneInternational(''), null);
});

test('+226 suivi d\'autre chose que 8 chiffres est refusé', () => {
  for (const saisie of ['+226 70 12 34', '+226 70 12 34 56 7', '00226123']) assert.equal(normaliserTelephone(saisie), null, saisie);
});

test('affichage pendant la saisie : groupes de deux chiffres, 8 au plus, indicatif retiré', () => {
  assert.equal(formaterSaisieTelephone('70123456'), '70 12 34 56');
  assert.equal(formaterSaisieTelephone('701'), '70 1');
  assert.equal(formaterSaisieTelephone('70 12 3'), '70 12 3');
  assert.equal(formaterSaisieTelephone('7012345678'), '70 12 34 56');
  assert.equal(formaterSaisieTelephone('+22670123456'), '70 12 34 56');
  assert.equal(formaterSaisieTelephone('0022670123456'), '70 12 34 56');
  assert.equal(formaterSaisieTelephone('70a12'), '70 12');
  assert.equal(formaterSaisieTelephone('+33 6 12'), '+33 6 12');
  assert.equal(formaterSaisieTelephone(''), '');
});

test('refuse les formes hors syntaxe', () => {
  for (const saisie of ['7012345', '701234567', '22670123456', '123', '+1234567', '+1234567890123456', '+0123456789', 'texte', '+', '00', null, undefined]) {
    assert.equal(normaliserTelephone(saisie), null, String(saisie));
  }
});

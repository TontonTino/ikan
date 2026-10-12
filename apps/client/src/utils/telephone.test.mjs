import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliserTelephone } from './telephone.ts';

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

test('refuse les numéros nationaux sans contexte pays et les formes hors syntaxe', () => {
  for (const saisie of ['70 12 34 56', '70123456', '22670123456', '123', '+1234567', '+1234567890123456', '+0123456789', 'texte', '+', '00', null, undefined]) {
    assert.equal(normaliserTelephone(saisie), null, String(saisie));
  }
});

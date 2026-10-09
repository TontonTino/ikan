// Lancer : npm test  (node --test, sans dépendance ; Node >= 22.18 pour importer du .ts)
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliserTelephone } from './telephone.ts';

test('formats valides -> 22670123456', () => {
  for (const saisie of ['70 12 34 56', '70123456', '+226 70123456', '+226 70 12 34 56', '0022670123456', '22670123456', ' +226-70.12.34.56 ']) {
    assert.equal(normaliserTelephone(saisie), '22670123456', saisie);
  }
});

test('invalides -> null', () => {
  for (const saisie of ['7012345', '701234567', '+226 7012345', '+33 6 12 34 56 78', 'abcdefgh', '70 12 34 5a', '', '   ', '+', '00', null, undefined]) {
    assert.equal(normaliserTelephone(saisie), null, String(saisie));
  }
});

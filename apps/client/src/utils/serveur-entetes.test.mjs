// Les en-têtes de sécurité du serveur de fichiers statiques (serveur/entetes-securite.mjs, JavaScript pur pour Node 20) doivent rester
// IDENTIQUES à ceux du middleware Astro (src/utils/securite.ts) : sinon une page et un fichier statique recevraient des règles différentes.
// Lancer : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { enTetesSecurite as parTs, origineApi as origineTs, politiqueCsp as cspTs } from '../utils/securite.ts';
import { enTetesSecurite as parMjs, origineApi as origineMjs, politiqueCsp as cspMjs, API_URL_PAR_DEFAUT } from '../../serveur/entetes-securite.mjs';

const ADRESSES = [API_URL_PAR_DEFAUT, 'https://api.exemple.org/api/v1', 'http://127.0.0.1:8099/api/v1', 'pas une url', ''];

test('mêmes en-têtes que le middleware, en production comme en développement, pour toute adresse d\'API', () => {
  for (const adresse of ADRESSES) {
    for (const production of [true, false]) assert.deepEqual(parMjs(adresse, production), parTs(adresse, production), `${adresse} ${production}`);
    assert.equal(cspMjs(adresse), cspTs(adresse), adresse);
    assert.equal(origineMjs(adresse), origineTs(adresse), adresse);
  }
});

test('l\'adresse d\'API par défaut est la même que celle du middleware', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.ok(source.includes(`'${API_URL_PAR_DEFAUT}'`));
});

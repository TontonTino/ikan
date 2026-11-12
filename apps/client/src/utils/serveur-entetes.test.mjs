// Les en-têtes de sécurité du serveur de fichiers statiques (serveur/entetes-securite.mjs, JavaScript pur pour Node 20) doivent rester
// IDENTIQUES à ceux du middleware Astro (src/utils/securite.ts) : sinon une page et un fichier statique recevraient des règles différentes.
// Lancer : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { enTetesSecurite as parTs, origineApi as origineTs, politiqueCsp as cspTs } from '../utils/securite.ts';
import { enTetesSecurite as parMjs, origineApi as origineMjs, politiqueCsp as cspMjs } from '../../serveur/entetes-securite.mjs';

const ADRESSES = ['http://localhost:8000/api/v1', 'https://api.exemple.org/api/v1', 'http://127.0.0.1:8099/api/v1', 'pas une url', ''];

test('mêmes en-têtes que le middleware, en production comme en développement, pour toute adresse d\'API', () => {
  for (const adresse of ADRESSES) {
    for (const production of [true, false]) assert.deepEqual(parMjs(adresse, production), parTs(adresse, production), `${adresse} ${production}`);
    assert.equal(cspMjs(adresse), cspTs(adresse), adresse);
    assert.equal(origineMjs(adresse), origineTs(adresse), adresse);
  }
});

test('le middleware et le serveur lisent l\'adresse d\'API par le même module, sans adresse codée', async () => {
  const { readFileSync } = await import('node:fs');
  for (const fichier of ['../middleware.ts', '../../serveur.mjs', '../../serveur/entetes-securite.mjs']) {
    const source = readFileSync(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /onrender\.com/, fichier);
  }
  assert.match(readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8'), /adresseApi\(import\.meta\.env\.PUBLIC_API_URL/);
  assert.match(readFileSync(new URL('../../serveur.mjs', import.meta.url), 'utf8'), /adresseApi\(process\.env\.PUBLIC_API_URL, true\)/);
});

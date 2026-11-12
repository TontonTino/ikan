// Adresse de l'API du formulaire client : PUBLIC_API_URL, repli local en développement, arrêt explicite en production.
// Lancer : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { API_URL_DEV, MESSAGE_API_MANQUANTE, adresseApi } from '../../serveur/adresse-api.mjs';

test('l\'adresse configurée fait foi, en développement comme en production', () => {
  assert.equal(adresseApi('https://api.exemple.org/api/v1', true), 'https://api.exemple.org/api/v1');
  assert.equal(adresseApi('  https://api.exemple.org/api/v1 ', false), 'https://api.exemple.org/api/v1');
});

test('sans adresse, repli sur l\'API locale en développement', () => {
  for (const valeur of [undefined, '', '   ']) assert.equal(adresseApi(valeur, false), API_URL_DEV);
  assert.match(API_URL_DEV, /^http:\/\/localhost:8000\//);
});

test('sans adresse, arrêt explicite en production, en nommant la variable', () => {
  for (const valeur of [undefined, '', '   ']) assert.throws(() => adresseApi(valeur, true), { message: MESSAGE_API_MANQUANTE });
  assert.match(MESSAGE_API_MANQUANTE, /PUBLIC_API_URL/);
});

test('le formulaire n\'a plus aucune adresse d\'API codée en dur', () => {
  const page = readFileSync(new URL('../pages/feedback/[code].astro', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /onrender\.com|DEFAULT_API_URL/);
  assert.match(page, /adresseApi\(import\.meta\.env\.PUBLIC_API_URL, import\.meta\.env\.PROD\)/);
});

test('le build de production vérifie l\'adresse', () => {
  const config = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /command !== 'build'/);
  assert.match(config, /adresseApi\(loadEnv\('production'/);
});

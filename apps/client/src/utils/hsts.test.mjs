// Lancer : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enTetesSecurite, politiqueCsp } from './securite.ts';

const API = 'https://ikan-772d.onrender.com/api/v1';
const FIXES = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

test('HSTS en production : 6 mois, sans includeSubDomains ni preload', () => {
  const h = enTetesSecurite(API, true);
  assert.equal(h['Strict-Transport-Security'], 'max-age=15552000');
  assert.equal(enTetesSecurite(API)['Strict-Transport-Security'], 'max-age=15552000'); // production par défaut (appel historique)
  assert.doesNotMatch(h['Strict-Transport-Security'], /includeSubDomains|preload/i);
});

test('HSTS absent hors production, les autres en-têtes restent posés', () => {
  const h = enTetesSecurite(API, false);
  assert.equal('Strict-Transport-Security' in h, false);
  for (const [nom, valeur] of Object.entries(FIXES)) assert.equal(h[nom], valeur, nom);
  assert.match(h['Permissions-Policy'], /camera=\(\)/);
  assert.ok(h['Content-Security-Policy-Report-Only']);
});

test('la CSP du client reste en Report-Only, sans en-tête bloquant', () => {
  for (const prod of [true, false]) {
    const h = enTetesSecurite(API, prod);
    assert.equal('Content-Security-Policy' in h, false);
    assert.match(h['Content-Security-Policy-Report-Only'], /^default-src 'self'/);
  }
  assert.doesNotMatch(politiqueCsp(API), /https:\/\/(?!ikan-772d)/);
});

test('le middleware transmet le mode production (import.meta.env.PROD) et pose les en-têtes sur toute réponse', () => {
  const src = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(src, /enTetesSecurite\([^)]*import\.meta\.env\.PROD\)/);
  assert.match(src, /reponse\.headers\.set\(nom, valeur\)/);
});

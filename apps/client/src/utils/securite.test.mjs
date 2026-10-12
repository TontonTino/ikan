// Lancer : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enTetesSecurite, ipVisiteur, origineApi, politiqueCsp } from './securite.ts';

const API = 'https://ikan-772d.onrender.com/api/v1';

test('tous les en-têtes de sécurité demandés sont présents', () => {
  const h = enTetesSecurite(API);
  for (const nom of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy-Report-Only']) {
    assert.ok(h[nom], nom);
  }
  assert.match(h['Strict-Transport-Security'], /max-age=\d{7,}/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.match(h['Referrer-Policy'], /strict-origin|no-referrer|same-origin/);
});

test('le micro reste autorisé pour le site lui-même, et seulement pour lui', () => {
  const pp = enTetesSecurite(API)['Permissions-Policy'];
  assert.match(pp, /microphone=\(self\)/);
  assert.doesNotMatch(pp, /microphone=\(\*\)|microphone=\(\)/);
  for (const interdit of ['camera=()', 'geolocation=()', 'payment=()']) assert.ok(pp.includes(interdit), interdit);
});

test('la CSP est en mode Report-Only : jamais d\'en-tête bloquant tant qu\'elle n\'est pas validée', () => {
  const h = enTetesSecurite(API);
  assert.equal('Content-Security-Policy' in h, false);
  const csp = h['Content-Security-Policy-Report-Only'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
});

test('la CSP autorise l\'API configurée (et elle seule) en connexion, et plus aucun domaine Google', () => {
  const csp = politiqueCsp(API);
  assert.match(csp, /connect-src 'self' https:\/\/ikan-772d\.onrender\.com(;|$)/);
  assert.doesNotMatch(csp, /google|gstatic/);
  assert.match(csp, /font-src 'self'(;|$)/);
  assert.equal(origineApi('pas une url'), null);
  assert.doesNotMatch(politiqueCsp('pas une url'), /undefined|null/);
});

test('le middleware Astro pose ces en-têtes sur toutes les réponses', () => {
  const src = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(src, /defineMiddleware/);
  assert.match(src, /enTetesSecurite\(/);
  assert.match(src, /reponse\.headers\.set\(/);
  assert.match(src, /export const onRequest/);
});

test('adresse du visiteur transmise à l\'API : X-Forwarded-For jamais cru tel quel', () => {
  assert.equal(ipVisiteur('1.1.1.1, 9.9.9.9', '10.0.0.5', 0), '10.0.0.5'); // aucun proxy de confiance : socket
  assert.equal(ipVisiteur('1.1.1.1, 9.9.9.9', '10.0.0.5', 1), '9.9.9.9');  // entrée posée par NOTRE proxy (à droite)
  assert.equal(ipVisiteur('1.1.1.1, 2.2.2.2, 9.9.9.9', '10.0.0.5', 2), '2.2.2.2');
  assert.equal(ipVisiteur(null, '10.0.0.5', 1), '10.0.0.5');
  assert.equal(ipVisiteur('9.9.9.9', '10.0.0.5', 3), '10.0.0.5');          // chaîne plus courte que prévu : socket
  assert.equal(ipVisiteur('', '', 1), null);
});

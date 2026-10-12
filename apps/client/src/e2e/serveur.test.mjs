// Test de bout en bout du serveur Astro RÉEL (build de production) face à une fausse API locale.
// Lancer : npm run test:e2e   (construit le client avec PUBLIC_API_URL pointant vers la fausse API, puis démarre dist/server/entry.mjs).
// Vérifie : statut HTTP 404 de la page d'erreur, en-têtes de sécurité sur toutes les réponses de page, aucune référence à
// Google Fonts, police servie localement, transmission de l'adresse du visiteur à l'API (secret partagé).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const PORT_API = 49321;
const PORT_CLIENT = 49322;
const SECRET = 'secret-de-test-e2e';
const racine = new URL('../../', import.meta.url);

let apiServeur;
let client;
const appelsApi = [];

function reponseApi(req, res) {
  appelsApi.push({ url: req.url, entetes: req.headers });
  const json = (statut, corps) => { res.writeHead(statut, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corps)); };
  if (req.url.includes('/QR-OK/validate')) return json(200, { agence_nom: 'Agence Test', retention_mois: 12 });
  if (req.url.includes('/QR-LENT/validate')) return json(429, { detail: 'Trop de demandes en peu de temps.' });
  return json(404, { detail: 'QR Code ou agence introuvable ou inactif' }); // QR inconnu, inactif ou agence désactivée
}

before(async () => {
  const env = { ...process.env, PUBLIC_API_URL: `http://127.0.0.1:${PORT_API}/api/v1` };
  execSync('npx astro build', { cwd: racine, env, stdio: 'ignore' });
  apiServeur = http.createServer(reponseApi);
  await new Promise((ok) => apiServeur.listen(PORT_API, '127.0.0.1', ok));
  client = spawn(process.execPath, ['./dist/server/entry.mjs'], {
    cwd: racine,
    env: { ...env, HOST: '127.0.0.1', PORT: String(PORT_CLIENT), SSR_FORWARD_SECRET: SECRET, TRUSTED_PROXY_HOPS: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT_CLIENT}/`); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('le serveur client ne démarre pas');
});

after(() => {
  client?.kill();
  apiServeur?.close();
});

const get = (chemin, entetes = {}) => fetch(`http://127.0.0.1:${PORT_CLIENT}${chemin}`, { headers: entetes });

const ENTETES = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy-report-only'];

test('page valide : 200, en-têtes de sécurité, micro autorisé pour le site, CSP en Report-Only', async () => {
  const r = await get('/feedback/QR-OK');
  assert.equal(r.status, 200);
  for (const nom of ENTETES) assert.ok(r.headers.get(nom), nom);
  assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/);
  assert.equal(r.headers.get('content-security-policy'), null);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('page valide : aucun appel Google Fonts, police locale préchargée, durée de conservation transmise à la page', async () => {
  const html = await (await get('/feedback/QR-OK')).text();
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(html, /href="\/fonts\/poppins-latin-400-normal\.woff2"/);
  assert.match(html, /data-retention-mois="12"/);
  assert.match(html, /1000 caractères restants sur 1000/);
  assert.match(html, /name="website"/);
});

test('la police locale est servie en woff2', async () => {
  const r = await get('/fonts/poppins-latin-400-normal.woff2');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /font\/woff2|application\/octet-stream/);
  assert.ok((await r.arrayBuffer()).byteLength > 4000);
});

test('QR refusé par l\'API (inconnu, inactif ou agence désactivée) : la page d\'erreur répond HTTP 404 et invite à prévenir l\'agence', async () => {
  const r = await get('/feedback/QR-AGENCE-DESACTIVEE');
  assert.equal(r.status, 404);
  const html = await r.text();
  assert.match(html, /QR Code non reconnu/);
  assert.match(html, /prévenir l'agence/);
  for (const nom of ENTETES) assert.ok(r.headers.get(nom), `${nom} sur la réponse 404`);
});

test('QR en limite de débit (429) : la page se charge, le navigateur revalidera', async () => {
  const r = await get('/feedback/QR-LENT');
  assert.equal(r.status, 200);
  assert.equal((await r.text()).includes('QR Code non reconnu'), false);
});

test('le serveur transmet à l\'API l\'adresse du visiteur (entrée posée par le proxy) avec le secret partagé', async () => {
  appelsApi.length = 0;
  await get('/feedback/QR-OK', { 'X-Forwarded-For': '1.2.3.4, 203.0.113.7' });
  const appel = appelsApi.find((a) => a.url.includes('/QR-OK/validate'));
  assert.ok(appel, 'validate appelé');
  assert.equal(appel.entetes['x-ikan-ssr-secret'], SECRET);
  assert.equal(appel.entetes['x-ikan-client-ip'], '203.0.113.7'); // jamais « 1.2.3.4 », saisi par le visiteur
});

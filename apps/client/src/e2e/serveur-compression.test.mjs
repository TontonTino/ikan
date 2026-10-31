// Serveur de production RÉEL (build Astro + serveur.mjs) : compression, cache et en-têtes de sécurité sur chaque type de réponse.
// Lancer : npm run test:e2e   (construit le client avec une adresse d'API factice, démarre `node ./serveur.mjs`).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';

const PORT_API = 49331;
const PORT_CLIENT = 49332;
const racine = new URL('../../', import.meta.url);
let api;
let client;

before(async () => {
  const env = { ...process.env, PUBLIC_API_URL: `http://127.0.0.1:${PORT_API}/api/v1` };
  execSync('npx astro build', { cwd: racine, env, stdio: 'ignore' });
  api = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/QR-OK/validate')) return res.end(JSON.stringify({ agence_nom: 'Agence Test', retention_mois: 12 }));
    res.statusCode = 404; res.end('{"detail":"introuvable"}');
  });
  await new Promise((ok) => api.listen(PORT_API, '127.0.0.1', ok));
  client = spawn(process.execPath, ['./serveur.mjs'], { cwd: racine, env: { ...env, HOST: '127.0.0.1', PORT: String(PORT_CLIENT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT_CLIENT}/`); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('le serveur client (serveur.mjs) ne démarre pas');
});

after(() => { client?.kill(); api?.close(); });

function demander(chemin, { encodage, methode = 'GET', entetes = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...entetes };
    if (encodage !== undefined) h['accept-encoding'] = encodage;
    http.request({ host: '127.0.0.1', port: PORT_CLIENT, path: chemin, method: methode, headers: h }, (res) => {
      const morceaux = [];
      res.on('data', (c) => morceaux.push(c));
      res.on('end', () => resolve({ statut: res.statusCode, entetes: res.headers, corps: Buffer.concat(morceaux) }));
    }).on('error', reject).end();
  });
}
const decompresser = (rep) => (rep.entetes['content-encoding'] === 'br' ? zlib.brotliDecompressSync(rep.corps) : rep.entetes['content-encoding'] === 'gzip' ? zlib.gunzipSync(rep.corps) : rep.corps);
const SECURITE = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy-report-only'];
const fichierDist = (chemin) => readFileSync(new URL(`../../dist/client${chemin}`, import.meta.url));

async function ressourcesDeLaPage() {
  const html = (await demander('/feedback/QR-OK', { encodage: 'identity' })).corps.toString('utf8');
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
  return {
    css: refs.find((r) => r.startsWith('/_astro/') && r.endsWith('.css')),
    js: refs.find((r) => r.startsWith('/_astro/') && r.endsWith('.js')),
    png: refs.find((r) => r.endsWith('.png')),
    police: refs.find((r) => r.endsWith('.woff2')),
  };
}

test('page du formulaire : compressée à la demande, identique une fois décompressée, jamais en cache public', async () => {
  const brut = await demander('/feedback/QR-OK', { encodage: 'identity' });
  assert.equal(brut.statut, 200);
  assert.equal(brut.entetes['content-encoding'], undefined);
  assert.match(brut.entetes.vary, /Accept-Encoding/i);
  assert.equal(brut.entetes['cache-control'], 'no-cache');
  assert.match(brut.entetes['content-type'], /text\/html/);
  for (const [demande, attendu] of [['gzip', 'gzip'], ['br', 'br']]) {
    const rep = await demander('/feedback/QR-OK', { encodage: demande });
    assert.equal(rep.entetes['content-encoding'], attendu);
    assert.match(rep.entetes.vary, /Accept-Encoding/i);
    assert.equal(rep.entetes['cache-control'], 'no-cache');
    assert.ok(rep.corps.length < brut.corps.length / 3, `${rep.corps.length} / ${brut.corps.length}`);
    assert.equal(decompresser(rep).toString('utf8'), brut.corps.toString('utf8'));
  }
});

test('JS et CSS versionnés : compressés, immutables pour un an', async () => {
  const { css, js } = await ressourcesDeLaPage();
  assert.ok(css && js, 'références /_astro/ trouvées dans la page');
  for (const chemin of [css, js]) {
    const brut = await demander(chemin, { encodage: 'identity' });
    assert.equal(brut.entetes['cache-control'], 'public, max-age=31536000, immutable', chemin);
    assert.deepEqual(brut.corps, fichierDist(chemin));
    const gz = await demander(chemin, { encodage: 'gzip' });
    assert.equal(gz.entetes['content-encoding'], 'gzip', chemin);
    assert.equal(gz.entetes['cache-control'], 'public, max-age=31536000, immutable', chemin);
    assert.match(gz.entetes.vary, /Accept-Encoding/i);
    assert.deepEqual(decompresser(gz), brut.corps);
    assert.ok(gz.corps.length < brut.corps.length / 2);
  }
});

test('polices et images à nom stable : jamais recompressées, 7 jours avec revalidation, octets inchangés', async () => {
  const { png, police } = await ressourcesDeLaPage();
  assert.ok(png && police);
  for (const chemin of [png, police, '/ikanai-mark.png']) {
    for (const encodage of ['identity', 'gzip', 'br']) {
      const rep = await demander(chemin, { encodage });
      assert.equal(rep.statut, 200, chemin);
      assert.equal(rep.entetes['content-encoding'], undefined, `${chemin} ${encodage}`);
      assert.equal(rep.entetes['cache-control'], 'public, max-age=604800, must-revalidate', chemin);
      assert.deepEqual(rep.corps, fichierDist(chemin), chemin);
    }
  }
});

test('SVG statique : compressé, 7 jours', async () => {
  const rep = await demander('/icons.svg', { encodage: 'gzip' });
  assert.equal(rep.entetes['content-encoding'], 'gzip');
  assert.equal(rep.entetes['cache-control'], 'public, max-age=604800, must-revalidate');
  assert.deepEqual(decompresser(rep), fichierDist('/icons.svg'));
});

test('en-têtes de sécurité sur CHAQUE type de réponse : page, erreur 404, JS, CSS, image, police, SVG, 304', async () => {
  const { css, js, png, police } = await ressourcesDeLaPage();
  const cas = ['/feedback/QR-OK', '/feedback/INCONNU', '/page-qui-n-existe-pas', '/', css, js, png, police, '/icons.svg'];
  for (const chemin of cas) {
    for (const encodage of ['identity', 'gzip', 'br']) {
      const rep = await demander(chemin, { encodage });
      for (const nom of SECURITE) assert.ok(rep.entetes[nom], `${chemin} (${encodage}) : ${nom} absent`);
      assert.equal(rep.entetes['x-content-type-options'], 'nosniff');
      assert.equal(rep.entetes['x-frame-options'], 'DENY');
    }
  }
  const premier = await demander(png, { encodage: 'identity' });
  const cond = await demander(png, { entetes: { 'if-none-match': premier.entetes.etag } });
  assert.equal(cond.statut, 304);
  for (const nom of SECURITE) assert.ok(cond.entetes[nom], `304 : ${nom}`);
});

test('revalidation : le 304 fonctionne sur une réponse compressée (ETag faible stable)', async () => {
  const { css } = await ressourcesDeLaPage();
  const gz = await demander(css, { encodage: 'gzip' });
  assert.ok(gz.entetes.etag && gz.entetes.etag.startsWith('W/'));
  const cond = await demander(css, { encodage: 'gzip', entetes: { 'if-none-match': gz.entetes.etag } });
  assert.equal(cond.statut, 304);
  assert.equal(cond.corps.length, 0);
});

test('pages d\'erreur : statut et contenu inchangés, jamais de cache public', async () => {
  const rep = await demander('/feedback/INCONNU', { encodage: 'identity' });
  assert.equal(rep.statut, 404);
  assert.match(rep.corps.toString('utf8'), /prévenir l'agence/);
  assert.equal(rep.entetes['cache-control'], 'no-cache');
  const gz = await demander('/feedback/INCONNU', { encodage: 'gzip' });
  assert.equal(gz.statut, 404);
  assert.equal(decompresser(gz).toString('utf8'), rep.corps.toString('utf8'));
});

test('HEAD : mêmes en-têtes, aucun corps, jamais compressé', async () => {
  const rep = await demander('/feedback/QR-OK', { methode: 'HEAD', encodage: 'gzip' });
  assert.equal(rep.statut, 200);
  assert.equal(rep.corps.length, 0);
  assert.equal(rep.entetes['content-encoding'], undefined);
  assert.equal(rep.entetes['cache-control'], 'no-cache');
});

// Enveloppe du serveur client (compression, cache, en-têtes de sécurité) : tests avec un gestionnaire factice, sans build ni réseau.
// Lancer : npm test
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { CACHE_PAGE, CACHE_PRIVE, CACHE_STABLE, CACHE_VERSIONNE, choisirEncodage, enveloppe, estVersionne, politiqueCache, typeCompressible } from '../../serveur/reponses.mjs';
import { enTetesSecurite } from '../../serveur/entetes-securite.mjs';

const ENTETES = enTetesSecurite('https://api.example.test/api/v1');
const GRAND_HTML = '<!doctype html><html><body>' + '<p>Votre avis compte pour nous, merci de votre visite.</p>'.repeat(200) + '</body></html>';
const GRAND_JS = 'export const a = () => {};\n'.repeat(600);
const ALEATOIRE = randomBytes(4000);                 // incompressible : le corps déjà encodé reste bien au-dessus du seuil
const OCTETS_PNG = Buffer.alloc(8000, 7);          // contenu quelconque : seul le type annoncé compte

/** Routes du gestionnaire factice : chacune reproduit une réponse réelle du serveur Astro. */
const routes = {
  '/page': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(GRAND_HTML); },
  '/page-flux': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); for (let i = 0; i < 40; i++) res.write(GRAND_HTML.slice(i * 100, (i + 1) * 100) || ' '); res.end(); },
  '/page-implicite': (req, res) => { res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.write(GRAND_HTML.slice(0, 2000)); res.end(GRAND_HTML.slice(2000)); },
  '/court': (req, res) => { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>Introuvable</h1>'); },
  '/court-flux': (req, res) => { res.writeHead(404, { 'Content-Type': 'text/html' }); res.write('<h1>Introuvable'); res.end('</h1>'); },
  '/court-longueur': (req, res) => { res.writeHead(400, { 'Content-Type': 'text/plain', 'Content-Length': 11 }); res.end('Bad request'); },
  '/_astro/app.AbCdEfGh.js': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable', ETag: 'W/"abc"' }); res.end(GRAND_JS); },
  '/_astro/sans-empreinte.js': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable', ETag: '"fort"' }); res.end(GRAND_JS); },
  '/ikanai-mark.png': (req, res) => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=0', ETag: 'W/"png"' }); res.end(OCTETS_PNG); },
  '/fonts/poppins.woff2': (req, res) => { res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=0' }); res.end(OCTETS_PNG); },
  '/icons.svg': (req, res) => { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=0' }); res.end('<svg>' + '<path d="M0 0"/>'.repeat(200) + '</svg>'); },
  '/donnees.json': (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ x: 'a'.repeat(3000) })); },
  '/deja-encode': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync(ALEATOIRE)); },
  '/no-transform': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-transform, public, max-age=60' }); res.end(GRAND_HTML); },
  '/sans-contenu': (req, res) => { res.writeHead(204); res.end(); },
  '/non-modifie': (req, res) => { res.writeHead(304, { ETag: 'W/"png"' }); res.end(); },
  '/avec-cookie': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'session=1; HttpOnly' }); res.end(GRAND_HTML); },
  '/cache-explicite': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'private, max-age=30' }); res.end(GRAND_HTML); },
  '/securite-existante': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'SAMEORIGIN' }); res.end(GRAND_HTML); },
  '/vary-existant': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', Vary: 'Origin' }); res.end(GRAND_HTML); },
  '/etag-fort': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/css', ETag: '"fort"', 'Cache-Control': 'public, max-age=0' }); res.end('a{color:red}\n'.repeat(300)); },
  '/enorme': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); const gros = GRAND_HTML.repeat(60); for (let i = 0; i < gros.length; i += 16384) res.write(gros.slice(i, i + 16384)); res.end(); },
};

const serveur = http.createServer(enveloppe((req, res) => {
  const route = routes[req.url.split('?')[0]];
  if (!route) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('x'); }
  route(req, res);
}, { entetes: ENTETES }));
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const PORT = serveur.address().port;
after(() => serveur.close());

/** Requête brute : jamais de décompression automatique (on veut voir les octets envoyés). */
function demander(chemin, { encodage, methode = 'GET', entetes = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...entetes };
    if (encodage !== undefined) h['accept-encoding'] = encodage;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: chemin, method: methode, headers: h }, (res) => {
      const morceaux = [];
      res.on('data', (c) => morceaux.push(c));
      res.on('end', () => resolve({ statut: res.statusCode, entetes: res.headers, corps: Buffer.concat(morceaux) }));
    });
    r.on('error', reject);
    r.end();
  });
}
const decompresser = (rep) => (rep.entetes['content-encoding'] === 'br' ? zlib.brotliDecompressSync(rep.corps) : rep.entetes['content-encoding'] === 'gzip' ? zlib.gunzipSync(rep.corps) : rep.corps);

// ─────────────────────────── négociation et types ───────────────────────────

test('choix de l\'encodage : brotli de préférence, gzip sinon, rien si refusé', () => {
  assert.equal(choisirEncodage('gzip, deflate, br'), 'br');
  assert.equal(choisirEncodage('gzip'), 'gzip');
  assert.equal(choisirEncodage('br;q=0, gzip'), 'gzip');
  assert.equal(choisirEncodage('gzip;q=0'), null);
  assert.equal(choisirEncodage('gzip;q=0.5, br;q=0.2'), 'gzip');
  assert.equal(choisirEncodage('*'), 'br');
  assert.equal(choisirEncodage('identity'), null);
  assert.equal(choisirEncodage(''), null);
  assert.equal(choisirEncodage(undefined), null);
  assert.equal(choisirEncodage('GZIP'), 'gzip');
});

test('types compressibles : texte seulement, jamais images ni polices', () => {
  for (const t of ['text/html', 'text/html; charset=utf-8', 'text/css', 'text/javascript', 'application/javascript', 'application/json', 'image/svg+xml', 'text/plain']) assert.ok(typeCompressible(t), t);
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'font/woff2', 'font/woff', 'application/zip', 'application/octet-stream', 'video/mp4', undefined, '']) assert.ok(!typeCompressible(t), String(t));
});

test('nom versionné : empreinte dans /_astro/ seulement', () => {
  assert.ok(estVersionne('/_astro/_code_.DckrCYVU.css'));
  assert.ok(estVersionne('/_astro/_code_.astro_astro_type_script_index_0_lang.UbhvZ-I9.js'));
  assert.ok(!estVersionne('/_astro/logo.png'));
  assert.ok(!estVersionne('/_astro/script.min.js'));
  assert.ok(!estVersionne('/ikanai-mark.png'));
  assert.ok(!estVersionne('/fonts/poppins-latin-400-normal.woff2'));
});

test('règles de cache pures', () => {
  assert.equal(politiqueCache({ chemin: '/feedback/QR', contentType: 'text/html', actuel: undefined }), CACHE_PAGE);
  assert.equal(politiqueCache({ chemin: '/ikanai-mark.png', contentType: 'image/png', actuel: 'public, max-age=0' }), CACHE_STABLE);
  assert.equal(politiqueCache({ chemin: '/_astro/a.AbCdEfGh.js', contentType: 'text/javascript', actuel: CACHE_VERSIONNE }), null);
  assert.equal(politiqueCache({ chemin: '/_astro/a.js', contentType: 'text/javascript', actuel: CACHE_VERSIONNE }), CACHE_STABLE);
  assert.equal(politiqueCache({ chemin: '/x', contentType: 'text/html', actuel: undefined, aCookie: true }), CACHE_PRIVE);
  assert.equal(politiqueCache({ chemin: '/x', contentType: 'text/html', actuel: 'private, max-age=30' }), null);
});

// ─────────────────────────── compression ───────────────────────────

test('HTML : compressé en gzip ou brotli à la demande, identique une fois décompressé', async () => {
  const brut = await demander('/page', { encodage: 'identity' });
  assert.equal(brut.entetes['content-encoding'], undefined);
  assert.equal(brut.corps.toString('utf8'), GRAND_HTML);
  for (const [demande, attendu] of [['gzip', 'gzip'], ['br', 'br'], ['gzip, deflate, br', 'br']]) {
    const rep = await demander('/page', { encodage: demande });
    assert.equal(rep.entetes['content-encoding'], attendu, demande);
    assert.ok(rep.corps.length < brut.corps.length / 10, `${demande} : ${rep.corps.length} octets pour ${brut.corps.length}`);
    assert.equal(decompresser(rep).toString('utf8'), GRAND_HTML, demande);
    assert.equal(rep.entetes['content-length'], undefined);
  }
});

test('sans Accept-Encoding : aucune compression, mais Vary présent', async () => {
  for (const encodage of [undefined, '', 'identity']) {
    const rep = await demander('/page', { encodage });
    assert.equal(rep.entetes['content-encoding'], undefined, String(encodage));
    assert.equal(rep.corps.toString('utf8'), GRAND_HTML);
    assert.match(rep.entetes.vary, /Accept-Encoding/i);
  }
  assert.equal((await demander('/page', { encodage: 'gzip;q=0' })).entetes['content-encoding'], undefined);
});

test('Vary: Accept-Encoding sur toute réponse compressée, fusionné avec un Vary existant', async () => {
  assert.match((await demander('/page', { encodage: 'gzip' })).entetes.vary, /Accept-Encoding/i);
  assert.match((await demander('/_astro/app.AbCdEfGh.js', { encodage: 'gzip' })).entetes.vary, /Accept-Encoding/i);
  assert.match((await demander('/icons.svg', { encodage: 'gzip' })).entetes.vary, /Accept-Encoding/i);
  const rep = await demander('/vary-existant', { encodage: 'gzip' });
  assert.match(rep.entetes.vary, /Origin/);
  assert.match(rep.entetes.vary, /Accept-Encoding/i);
});

test('tous les types texte sont compressés : HTML, JS, CSS, SVG, JSON', async () => {
  for (const chemin of ['/page', '/_astro/app.AbCdEfGh.js', '/etag-fort', '/icons.svg', '/donnees.json']) {
    const rep = await demander(chemin, { encodage: 'gzip' });
    assert.equal(rep.entetes['content-encoding'], 'gzip', chemin);
    const brut = await demander(chemin, { encodage: 'identity' });
    assert.deepEqual(decompresser(rep), brut.corps, chemin);
  }
});

test('images et polices jamais recompressées : octets identiques, sans Content-Encoding ni Vary', async () => {
  for (const chemin of ['/ikanai-mark.png', '/fonts/poppins.woff2']) {
    for (const encodage of ['gzip', 'br', 'gzip, br']) {
      const rep = await demander(chemin, { encodage });
      assert.equal(rep.entetes['content-encoding'], undefined, `${chemin} ${encodage}`);
      assert.equal(rep.entetes.vary, undefined, `${chemin} ${encodage}`);
      assert.deepEqual(rep.corps, OCTETS_PNG);
    }
  }
});

test('réponses très courtes jamais compressées (erreurs comprises), avec ou sans longueur annoncée', async () => {
  for (const chemin of ['/court', '/court-flux', '/court-longueur', '/inconnue']) {
    const rep = await demander(chemin, { encodage: 'gzip, br' });
    assert.equal(rep.entetes['content-encoding'], undefined, chemin);
    assert.ok(rep.corps.length > 0 && rep.corps.length < 1024, chemin);
  }
  assert.equal((await demander('/court', { encodage: 'gzip' })).corps.toString('utf8'), '<h1>Introuvable</h1>');
  assert.equal((await demander('/court-flux', { encodage: 'gzip' })).corps.toString('utf8'), '<h1>Introuvable</h1>');
  assert.equal((await demander('/court-flux', { encodage: 'gzip' })).statut, 404);
});

test('réponse en flux (plusieurs write) et en-têtes implicites : compressée et identique', async () => {
  for (const chemin of ['/page-flux', '/page-implicite']) {
    const rep = await demander(chemin, { encodage: 'br' });
    assert.equal(rep.entetes['content-encoding'], 'br', chemin);
    const brut = await demander(chemin, { encodage: 'identity' });
    assert.deepEqual(decompresser(rep), brut.corps, chemin);
  }
});

test('très grosse réponse (≈ 700 Ko) : flux complet et identique', async () => {
  const rep = await demander('/enorme', { encodage: 'gzip' });
  const brut = await demander('/enorme', { encodage: 'identity' });
  assert.equal(rep.entetes['content-encoding'], 'gzip');
  assert.ok(brut.corps.length > 600_000);
  assert.deepEqual(decompresser(rep), brut.corps);
});

test('jamais de compression : HEAD, 204, 304, réponse déjà encodée, no-transform', async () => {
  const head = await demander('/page', { encodage: 'gzip', methode: 'HEAD' });
  assert.equal(head.entetes['content-encoding'], undefined);
  assert.equal(head.corps.length, 0);
  assert.equal((await demander('/sans-contenu', { encodage: 'gzip' })).statut, 204);
  const nm = await demander('/non-modifie', { encodage: 'gzip' });
  assert.equal(nm.statut, 304);
  assert.equal(nm.entetes['content-encoding'], undefined);
  const deja = await demander('/deja-encode', { encodage: 'br' });
  assert.equal(deja.entetes['content-encoding'], 'gzip');
  assert.ok(deja.corps.length > 1024, 'le corps déjà encodé dépasse le seuil : le test prouve bien l absence de double compression');
  assert.deepEqual(zlib.gunzipSync(deja.corps), ALEATOIRE);                      // pas de double compression
  const nt = await demander('/no-transform', { encodage: 'gzip' });
  assert.equal(nt.entetes['content-encoding'], undefined);
  assert.equal(nt.corps.toString('utf8'), GRAND_HTML);
});

test('ETag fort affaibli quand le corps est compressé, faible laissé tel quel', async () => {
  assert.equal((await demander('/etag-fort', { encodage: 'gzip' })).entetes.etag, 'W/"fort"');
  assert.equal((await demander('/etag-fort', { encodage: 'identity' })).entetes.etag, '"fort"');
  assert.equal((await demander('/_astro/app.AbCdEfGh.js', { encodage: 'gzip' })).entetes.etag, 'W/"abc"');
});

// ─────────────────────────── cache ───────────────────────────

test('fichier versionné : un an, immutable (compressé ou non)', async () => {
  for (const encodage of ['identity', 'gzip']) {
    assert.equal((await demander('/_astro/app.AbCdEfGh.js', { encodage })).entetes['cache-control'], CACHE_VERSIONNE);
  }
});

test('« immutable » jamais sur un fichier de /_astro/ sans empreinte (ramené à 7 jours avec revalidation)', async () => {
  assert.equal((await demander('/_astro/sans-empreinte.js')).entetes['cache-control'], CACHE_STABLE);
});

test('polices, images et SVG à nom stable : 7 jours avec revalidation, plus max-age=0', async () => {
  for (const chemin of ['/ikanai-mark.png', '/fonts/poppins.woff2', '/icons.svg']) {
    assert.equal((await demander(chemin)).entetes['cache-control'], 'public, max-age=604800, must-revalidate', chemin);
  }
});

test('pages HTML : jamais de cache public (no-cache), erreurs comprises', async () => {
  for (const chemin of ['/page', '/court', '/inconnue', '/page-flux']) {
    const cc = (await demander(chemin, { encodage: 'gzip' })).entetes['cache-control'];
    assert.equal(cc, 'no-cache', chemin);
    assert.doesNotMatch(cc, /public|max-age=[1-9]|immutable/);
  }
});

test('réponse qui pose un cookie : private, no-store, jamais public', async () => {
  assert.equal((await demander('/avec-cookie')).entetes['cache-control'], CACHE_PRIVE);
});

test('un Cache-Control posé explicitement par l\'application n\'est pas écrasé', async () => {
  assert.equal((await demander('/cache-explicite')).entetes['cache-control'], 'private, max-age=30');
  assert.equal((await demander('/no-transform')).entetes['cache-control'], 'no-transform, public, max-age=60');
});

// ─────────────────────────── en-têtes de sécurité ───────────────────────────

test('en-têtes de sécurité présents sur chaque type de réponse, compressée ou non', async () => {
  const chemins = ['/page', '/court', '/inconnue', '/_astro/app.AbCdEfGh.js', '/ikanai-mark.png', '/fonts/poppins.woff2', '/icons.svg', '/donnees.json', '/sans-contenu', '/non-modifie', '/court-longueur', '/deja-encode'];
  for (const chemin of chemins) {
    for (const encodage of ['identity', 'gzip', 'br']) {
      const rep = await demander(chemin, { encodage });
      for (const [nom, valeur] of Object.entries(ENTETES)) assert.equal(rep.entetes[nom.toLowerCase()], valeur, `${chemin} ${encodage} ${nom}`);
    }
  }
  const head = await demander('/page', { methode: 'HEAD', encodage: 'gzip' });
  for (const nom of Object.keys(ENTETES)) assert.ok(head.entetes[nom.toLowerCase()], `HEAD ${nom}`);
});

test('un en-tête de sécurité déjà posé n\'est pas écrasé', async () => {
  assert.equal((await demander('/securite-existante')).entetes['x-frame-options'], 'SAMEORIGIN');
});

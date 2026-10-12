// Test de bout en bout du serveur Astro RÉEL (build de production) face à une fausse API locale.
// Lancer : npm run test:e2e   (construit le client avec PUBLIC_API_URL pointant vers la fausse API, puis démarre dist/server/entry.mjs).
// Partie 1 (HTTP) : statut 404 de la page d'erreur, en-têtes de sécurité, aucune référence à Google Fonts, police locale,
//   transmission de l'adresse du visiteur à l'API.
// Partie 2 (navigateur réel, puppeteer-core) : les DEUX chemins du parcours (« Noter l'expérience » et « Partager une
//   idée »), échec réseau, double clic, zones tactiles. Navigateur : variable CHROME_PATH, sinon Chrome/Edge/Chromium
//   usuels ; sans navigateur, la partie 2 est IGNORÉE (et signalée comme telle), jamais simulée.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';

const PORT_API = 49321;
const PORT_CLIENT = 49322;
const SECRET = 'secret-de-test-e2e';
const racine = new URL('../../', import.meta.url);

let apiServeur;
let client;
const appelsApi = [];
const posts = []; // POST reçus par la fausse API : { chemin, corps }
const comportement = { idee: [] }; // file de comportements pour POST /suggestions : un statut HTTP (ex. 429) ; sinon 201

function lireCorps(req) {
  return new Promise((ok) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => ok(b));
  });
}

async function reponseApi(req, res) {
  appelsApi.push({ url: req.url, entetes: req.headers });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' };
  const json = (statut, corps) => { res.writeHead(statut, cors); res.end(JSON.stringify(corps)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'POST') {
    const corps = JSON.parse((await lireCorps(req)) || '{}');
    posts.push({ chemin: req.url.split('?')[0], corps });
    if (req.url.includes('/suggestions')) {
      const c = comportement.idee.shift();
      if (typeof c === 'number') return json(c, { detail: 'Trop de demandes en peu de temps.' });
      return json(201, { message: "Merci, votre idée a bien été transmise à l'agence." });
    }
    return json(201, { id: '00000000-0000-4000-8000-000000000001', nps_token: 'jeton', message: 'Merci' });
  }
  if (req.url.includes('/QR-OK/validate')) return json(200, { agence_nom: 'Agence Test', retention_mois: 12 });
  if (req.url.includes('/QR-OK/categories')) return json(200, [{ id: 'c1', nom: 'Accueil' }, { id: 'c2', nom: 'Caisse' }]);
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

// ───────────────────────── partie 1 : HTTP ─────────────────────────

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

test('la page d\'entrée propose l\'accueil à deux choix et plus la phrase « anonyme »', async () => {
  const html = await (await get('/feedback/QR-OK')).text();
  assert.match(html, /Noter l'expérience/);
  assert.match(html, /Partager une idée/);
  assert.match(html, /Votre avis est confidentiel\./);
  assert.doesNotMatch(html, /anonyme/i);
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

// ───────────────────────── partie 2 : navigateur réel ─────────────────────────

function trouverNavigateur() {
  const candidats = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidats.find((c) => c && existsSync(c)) || null;
}

const navigateurChemin = trouverNavigateur();
let navigateur;
const SANS_NAVIGATEUR = navigateurChemin ? false : 'aucun navigateur (définir CHROME_PATH) : parcours en navigateur ignoré';

async function ouvrir() {
  if (!navigateur) {
    const puppeteer = (await import('puppeteer-core')).default;
    navigateur = await puppeteer.launch({ executablePath: navigateurChemin, headless: 'new' });
  }
  const page = await navigateur.newPage();
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  posts.length = 0;
  comportement.idee.length = 0;
  await page.goto(`http://127.0.0.1:${PORT_CLIENT}/feedback/QR-OK`, { waitUntil: 'networkidle0' });
  return page;
}

const visible = (page, id) => page.$eval(`#${id}`, (e) => getComputedStyle(e).display !== 'none' && !e.hidden);
const attendre = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && getComputedStyle(e).display !== 'none'; }, { timeout: 8000 }, id);

after(async () => { await navigateur?.close(); });

test('accueil : nom de l\'agence et deux choix, le formulaire noté attend', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  assert.equal(await visible(page, 'screen-accueil'), true);
  assert.equal(await visible(page, 'screen-sentiment'), false);
  assert.equal(await visible(page, 'screen-idee'), false);
  assert.equal(await page.$eval('#accueilAgenceNom', (e) => e.textContent.trim()), 'Agence Test');
  assert.equal((await page.$$('#screen-accueil button')).length, 2);
  await page.close();
});

test('chemin 1 « Noter l\'expérience » : accueil → formulaire → confirmation, un seul avis envoyé, aucune idée', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  const ecrans = [];
  const noter = async () => { for (const id of ['screen-accueil', 'screen-sentiment', 'screen-success']) if (await visible(page, id)) ecrans.push(id); };
  await noter();
  await page.click('#btnChoixNote');
  await attendre(page, 'screen-sentiment');
  await noter();
  assert.equal(await visible(page, 'screen-accueil'), false);
  await page.select('#categorieSelect', 'c1');
  await page.click('.sentiment-tile[data-sentiment=bien]');
  await page.click('#btnSubmitFeedback');
  await attendre(page, 'screen-success');
  await noter();
  assert.deepEqual(ecrans, ['screen-accueil', 'screen-sentiment', 'screen-success']);
  const avis = posts.filter((p) => p.chemin.endsWith('/feedbacks/'));
  assert.equal(avis.length, 1);
  assert.equal(avis[0].corps.note, 4);
  assert.equal(avis[0].corps.souhaite_etre_rappele, false);
  assert.equal(posts.some((p) => p.chemin.includes('/suggestions')), false);
  await page.close();
});

test('chemin 2 « Partager une idée » : accueil → idée → confirmation, sans note ni contact, compteur, moins de 90 s', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  const debut = Date.now();
  await page.click('#btnChoixIdee');
  await attendre(page, 'screen-idee');
  assert.equal(await visible(page, 'screen-accueil'), false);
  assert.equal(await page.$eval('#ideeCharCount', (e) => e.textContent), '1000 caractères restants sur 1000');
  await page.type('#inputIdee', 'Ajouter une rampe.');
  assert.equal(await page.$eval('#ideeCharCount', (e) => e.textContent), '982 caractères restants sur 1000');
  assert.equal(await page.$$eval('#screen-idee input[type=tel], #screen-idee input[type=email], #screen-idee input[type=checkbox]', (l) => l.length), 0);
  await page.click('#btnSubmitIdee');
  await attendre(page, 'screen-idee-merci');
  assert.match(await page.$eval('#screen-idee-merci', (e) => e.textContent), /Merci pour votre idée !/);
  const idees = posts.filter((p) => p.chemin.includes('/qr-codes/QR-OK/suggestions'));
  assert.equal(idees.length, 1);
  assert.deepEqual(idees[0].corps, { contenu: 'Ajouter une rampe.', website: '' }); // aucun contact, aucune note
  assert.equal(posts.some((p) => p.chemin.endsWith('/feedbacks/')), false);
  assert.ok(Date.now() - debut < 90_000);
  await page.click('#btnIdeeAccueil');
  await attendre(page, 'screen-accueil');
  await page.close();
});

test('idée : « Retour » ramène à l\'accueil ; idée vide refusée sans envoi', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  await page.click('#btnChoixIdee');
  await attendre(page, 'screen-idee');
  await page.click('#btnSubmitIdee');
  assert.match(await page.$eval('#ideeError', (e) => e.textContent), /Écrivez votre idée/);
  assert.equal(posts.length, 0);
  await page.click('#btnRetourIdee');
  await attendre(page, 'screen-accueil');
  await page.close();
});

test('idée : échec réseau puis refus 429 : le texte reste, message non technique, nouvelle tentative possible', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  await page.click('#btnChoixIdee');
  await attendre(page, 'screen-idee');
  await page.type('#inputIdee', 'Mon idée à ne pas perdre');
  comportement.idee.push(429);

  await page.setOfflineMode(true); // vraie coupure réseau côté navigateur
  await page.click('#btnSubmitIdee');
  await page.waitForFunction(() => !document.getElementById('ideeError').hidden, { timeout: 8000 });
  await page.setOfflineMode(false);
  const message = await page.$eval('#ideeError', (e) => e.textContent);
  assert.match(message, /Pas de connexion/);
  assert.match(message, /n'a pas été envoyée/);
  assert.doesNotMatch(message, /fetch|Failed|HTTP|\b[45]\d\d\b|exception/i);
  assert.equal(await page.$eval('#inputIdee', (e) => e.value), 'Mon idée à ne pas perdre');
  assert.equal(await page.$eval('#btnSubmitIdee', (e) => e.disabled), false);
  assert.equal(await visible(page, 'screen-idee-merci'), false);

  await page.click('#btnSubmitIdee'); // 2e tentative : refus 429
  await page.waitForFunction(() => /Trop de demandes/.test(document.getElementById('ideeError').textContent), { timeout: 8000 });
  assert.equal(await page.$eval('#inputIdee', (e) => e.value), 'Mon idée à ne pas perdre');

  await page.click('#btnSubmitIdee'); // 3e tentative : succès
  await attendre(page, 'screen-idee-merci');
  assert.equal(posts.filter((p) => p.chemin.includes('/suggestions')).length, 2); // la coupure n'a rien envoyé : 429 puis succès
  await page.close();
});

test('idée : double clic = un seul envoi (verrou du bouton)', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  await page.click('#btnChoixIdee');
  await attendre(page, 'screen-idee');
  await page.type('#inputIdee', 'Une seule fois');
  await page.$eval('#btnSubmitIdee', (b) => { b.click(); b.click(); b.click(); });
  await attendre(page, 'screen-idee-merci');
  assert.equal(posts.filter((p) => p.chemin.includes('/suggestions')).length, 1);
  await page.close();
});

test('idée : le champ piège rempli par un robot est transmis tel quel (l\'API répond comme un succès sans rien enregistrer)', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  await page.click('#btnChoixIdee');
  await attendre(page, 'screen-idee');
  await page.type('#inputIdee', 'Texte de robot');
  await page.$eval('#champIdeeSiteWeb', (e) => { e.value = 'http://spam.example'; });
  await page.click('#btnSubmitIdee');
  await attendre(page, 'screen-idee-merci');
  assert.equal(posts.find((p) => p.chemin.includes('/suggestions')).corps.website, 'http://spam.example');
  await page.close();
});

test('zones tactiles ≥ 44 × 44 px mesurées dans le navigateur : accueil, idée, confirmation', { skip: SANS_NAVIGATEUR }, async () => {
  const page = await ouvrir();
  const mesurer = (etiquette) => page.evaluate((nom) => {
    const faibles = [];
    document.querySelectorAll('button, input, select, textarea').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]') || el.closest('.champ-piege') || el.closest('[style*="display:none"]') || el.closest('[style*="display: none"]')) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.width < 44 || r.height < 44) faibles.push(`${nom} ${el.id || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return faibles;
  }, etiquette);
  let faibles = await mesurer('accueil');
  await page.click('#btnChoixIdee'); await attendre(page, 'screen-idee');
  faibles = faibles.concat(await mesurer('idée'));
  await page.type('#inputIdee', 'Texte'); await page.click('#btnSubmitIdee'); await attendre(page, 'screen-idee-merci');
  faibles = faibles.concat(await mesurer('confirmation'));
  assert.deepEqual(faibles, []);
  await page.close();
});

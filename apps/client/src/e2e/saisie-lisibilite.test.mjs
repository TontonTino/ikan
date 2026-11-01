// Navigateur RÉEL (Chrome/Edge via puppeteer-core) sur le build de production : lisibilité à 320 / 360 / 412 px et saisie conservée (CL-04, CL-07).
// Lancer : npm run test:e2e. Sans puppeteer-core ou sans navigateur, ces tests sont IGNORÉS (et signalés), jamais simulés.
// Navigateur : CHROME_PATH ou Chrome/Edge usuels. puppeteer-core non installé dans le dépôt : PUPPETEER_CORE_PATH peut désigner
// un autre emplacement (…/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const PORT_API = 49341;
const PORT_CLIENT = 49342;
const racine = new URL('../../', import.meta.url);

const NOMS = {
  'QR-OK': 'Agence Test',
  'QR-AUTRE': 'Autre Agence',
  'QR-LONG43': 'Agence Premium Centre Commercial Ouaga 2000',
  'QR-LONG80': 'Agence Premium Centre Commercial Ouaga 2000 Zone Industrielle Secteur Nord Extension Cissin',
};
const posts = [];
const mode = { envoi: 'ok' };

let api;
let client;
let navigateur;

async function importerPuppeteer() {
  try { return (await import('puppeteer-core')).default; } catch { /* essai suivant */ }
  if (process.env.PUPPETEER_CORE_PATH) {
    try { return (await import(pathToFileURL(process.env.PUPPETEER_CORE_PATH).href)).default; } catch { /* abandon */ }
  }
  return null;
}
function trouverNavigateur() {
  const candidats = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidats.find((c) => c && existsSync(c)) || null;
}
const puppeteer = await importerPuppeteer();
const navigateurChemin = trouverNavigateur();
const SKIP = !puppeteer ? 'puppeteer-core non installé (npm i -D puppeteer-core, ou PUPPETEER_CORE_PATH)' : !navigateurChemin ? 'aucun navigateur (définir CHROME_PATH)' : false;

before(async () => {
  if (SKIP) return;
  const env = { ...process.env, PUBLIC_API_URL: `http://127.0.0.1:${PORT_API}/api/v1` };
  execSync('npx astro build', { cwd: racine, env, stdio: 'ignore' });
  api = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'POST') {
      let b = ''; req.on('data', (d) => (b += d)); await new Promise((r) => req.on('end', r));
      posts.push(JSON.parse(b || '{}'));
      if (mode.envoi === 'ok') { res.writeHead(201, cors); return res.end(JSON.stringify({ id: 'f1', nps_token: 'jeton' })); }
      res.writeHead(500, cors); return res.end('{"detail":"erreur"}');
    }
    const code = (req.url.match(/qr-codes\/([^/?]+)/) || [])[1];
    if (!NOMS[code]) { res.writeHead(404, cors); return res.end('{"detail":"introuvable"}'); }
    res.writeHead(200, cors);
    if (req.url.includes('/categories')) return res.end(JSON.stringify([{ id: 'c1', nom: 'Accueil' }, { id: 'c2', nom: 'Attente' }]));
    res.end(JSON.stringify({ agence_nom: NOMS[code], retention_mois: 12 }));
  });
  await new Promise((ok) => api.listen(PORT_API, '127.0.0.1', ok));
  client = spawn(process.execPath, ['./serveur.mjs'], { cwd: racine, env: { ...env, HOST: '127.0.0.1', PORT: String(PORT_CLIENT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT_CLIENT}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  navigateur = await puppeteer.launch({ executablePath: navigateurChemin, headless: 'new' });
});

after(async () => { await navigateur?.close(); client?.kill(); api?.close(); });

async function ouvrir(code, largeur = 360, { avant } = {}) {
  const contexte = await navigateur.createBrowserContext();
  const page = await contexte.newPage();
  await page.setViewport({ width: largeur, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (avant) await page.evaluateOnNewDocument(avant);
  await page.goto(`http://127.0.0.1:${PORT_CLIENT}/feedback/${code}`, { waitUntil: 'networkidle0' });
  return { page, fermer: () => contexte.close() };
}
const attendreCategories = (page) => page.waitForFunction(() => { const s = document.getElementById('categorieSelect'); return s && !s.disabled && s.options.length > 1; });
const visible = (page, id) => page.$eval(`#${id}`, (e) => getComputedStyle(e).display !== 'none' && !e.hidden);

async function remplirNote(page, { categorie = 'c2', niveau = 'mauvais', commentaire = 'Attente trop longue au guichet' } = {}) {
  await page.tap('#btnChoixNote');
  await attendreCategories(page);
  await page.select('#categorieSelect', categorie);
  await page.tap(`.sentiment-tile[data-sentiment="${niveau}"]`);
  if (commentaire) await page.type('#inputCommentaire', commentaire);
}
const etatFormulaire = (page) => page.evaluate(() => ({
  ecranFormulaire: getComputedStyle(document.getElementById('screen-sentiment')).display !== 'none',
  ecranAccueil: getComputedStyle(document.getElementById('screen-accueil')).display !== 'none',
  categorie: document.getElementById('categorieSelect').value,
  niveau: document.querySelector('.sentiment-tile[aria-checked=true]')?.dataset.sentiment ?? null,
  commentaire: document.getElementById('inputCommentaire').value,
  recontactOui: document.getElementById('recontactYes').classList.contains('is-active'),
  telephone: document.getElementById('contactTelInput').value,
  consentement: document.getElementById('consentCheckbox').checked,
}));
const stockage = (page) => page.evaluate(() => ({ session: sessionStorage.getItem('ikan.saisie.v1'), nbLocal: localStorage.length }));

// ─────────────────────────── lisibilité : 320 / 360 / 412 px ───────────────────────────

for (const code of ['QR-LONG43', 'QR-LONG80']) {
  for (const largeur of [320, 360, 412]) {
    test(`nom d'agence de ${NOMS[code].length} caractères à ${largeur} px : nom complet lisible, aucune coupure, aucun défilement horizontal`, { skip: SKIP }, async () => {
      const { page, fermer } = await ouvrir(code, largeur);
      try {
        const m = await page.evaluate(() => {
          const chip = document.getElementById('agencyBadgeContainer'); const t = document.getElementById('agencyBadgeText'); const r = chip.getBoundingClientRect();
          return { texte: t.textContent, gauche: r.left, droite: r.right, coupeX: t.scrollWidth > t.clientWidth + 1, coupeY: chip.scrollHeight > chip.clientHeight + 1,
                   defilement: document.documentElement.scrollWidth > innerWidth, largeurPage: innerWidth };
        });
        assert.equal(m.texte, NOMS[code]);
        assert.ok(m.gauche >= 0 && m.droite <= m.largeurPage, `pastille hors de l'écran : ${m.gauche}-${m.droite} / ${m.largeurPage}`);
        assert.equal(m.coupeX, false);
        assert.equal(m.coupeY, false);
        assert.equal(m.defilement, false);
      } finally { await fermer(); }
    });
  }
}

for (const largeur of [320, 360, 412]) {
  test(`écran de note à ${largeur} px : étiquettes ≥ 12 px entières dans leur case, cases ≥ 44 px, grille dans l'écran, aucun défilement horizontal`, { skip: SKIP }, async () => {
    const { page, fermer } = await ouvrir('QR-LONG80', largeur);
    try {
      await page.tap('#btnChoixNote');
      await attendreCategories(page);
      const m = await page.evaluate(() => {
        const tuiles = [...document.querySelectorAll('.sentiment-tile')];
        const g = document.getElementById('sentimentsGrid').getBoundingClientRect();
        return {
          grilleDansEcran: g.left >= 0 && g.right <= innerWidth, defilement: document.documentElement.scrollWidth > innerWidth,
          tuiles: tuiles.map((t) => {
            const l = t.querySelector('.tile-label'); const rg = document.createRange(); rg.selectNodeContents(l);
            const tr = rg.getBoundingClientRect(); const br = t.getBoundingClientRect();
            return { mot: l.textContent, police: parseFloat(getComputedStyle(l).fontSize), margeGauche: tr.left - br.left, margeDroite: br.right - tr.right, w: br.width, h: br.height, lignes: Math.round(tr.height / parseFloat(getComputedStyle(l).lineHeight || '16')) };
          }),
        };
      });
      assert.equal(m.defilement, false);
      assert.ok(m.grilleDansEcran);
      assert.equal(m.tuiles.length, 5);
      for (const t of m.tuiles) {
        assert.ok(t.police >= 12, `${t.mot} : ${t.police} px`);
        assert.ok(t.margeGauche >= 1 && t.margeDroite >= 1, `${t.mot} dépasse de sa case (${t.margeGauche.toFixed(1)} / ${t.margeDroite.toFixed(1)} px)`);
        assert.ok(t.w >= 44 && t.h >= 44, `${t.mot} : zone tactile ${t.w.toFixed(0)}×${t.h.toFixed(0)} px`);
      }
    } finally { await fermer(); }
  });
}

// ─────────────────────────── saisie conservée ───────────────────────────

test('chemin « Noter » en échec réseau : message, saisie conservée, rechargement hors ligne puis en ligne : tout est restauré sur le formulaire', { skip: SKIP }, async () => {
  const { page, fermer } = await ouvrir('QR-OK');
  try {
    posts.length = 0;
    await remplirNote(page);
    await page.setOfflineMode(true);
    await page.tap('#btnSubmitFeedback');
    await page.waitForFunction(() => !document.getElementById('submitError').hidden);
    const message = await page.$eval('#submitError', (e) => e.textContent);
    assert.match(message, /Pas de connexion/);
    assert.match(message, /votre avis n'a pas été envoyé/);
    const apresEchec = await etatFormulaire(page);
    assert.equal(apresEchec.ecranFormulaire, true);
    assert.equal(apresEchec.categorie, 'c2');
    assert.equal(apresEchec.niveau, 'mauvais');
    assert.equal(apresEchec.commentaire, 'Attente trop longue au guichet');
    assert.equal(posts.length, 0);
    await page.setOfflineMode(false);
    await page.reload({ waitUntil: 'networkidle0' });
    await attendreCategories(page);
    const apres = await etatFormulaire(page);
    assert.equal(apres.ecranFormulaire, true, 'replacé sur le formulaire');
    assert.equal(apres.ecranAccueil, false);
    assert.equal(apres.categorie, 'c2');
    assert.equal(apres.niveau, 'mauvais');
    assert.equal(apres.commentaire, 'Attente trop longue au guichet');
    assert.equal(await page.$eval('#charCount', (e) => e.textContent), `${1000 - 'Attente trop longue au guichet'.length} caractères restants sur 1000`);
    // le réseau est revenu : un seul appui suffit, l'avis part une fois et la mémoire est vidée
    await page.tap('#btnSubmitFeedback');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('screen-success')).display !== 'none');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].note, 1);
    assert.equal((await stockage(page)).session, null);
  } finally { await fermer(); }
});

test('le contact et le consentement ne sont JAMAIS stockés ni restaurés ; sessionStorage seulement', { skip: SKIP }, async () => {
  const { page, fermer } = await ouvrir('QR-OK');
  try {
    await remplirNote(page, { commentaire: 'Bon accueil', niveau: 'bien', categorie: 'c1' });
    await page.tap('#recontactYes');
    await page.type('#contactTelInput', '+22670123456');
    await page.tap('#consentCheckbox');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const s = await stockage(page);
    assert.ok(s.session, 'saisie mémorisée');
    assert.equal(s.nbLocal, 0, 'localStorage jamais utilisé');
    for (const interdit of ['70123456', '22670123456', 'telephone', 'consent', 'rappele']) assert.ok(!s.session.toLowerCase().includes(interdit), interdit);
    assert.deepEqual(Object.keys(JSON.parse(s.session)).sort(), ['categorieId', 'commentaire', 'niveau', 'qr', 'ts', 'v']);
    await page.reload({ waitUntil: 'networkidle0' });
    await attendreCategories(page);
    const apres = await etatFormulaire(page);
    assert.equal(apres.commentaire, 'Bon accueil');
    assert.equal(apres.recontactOui, false);
    assert.equal(apres.telephone, '');
    assert.equal(apres.consentement, false);
  } finally { await fermer(); }
});

test('après un envoi confirmé : mémoire effacée, un rechargement ramène à l\'accueil, formulaire vide', { skip: SKIP }, async () => {
  const { page, fermer } = await ouvrir('QR-OK');
  try {
    await remplirNote(page);
    await page.tap('#btnSubmitFeedback');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('screen-success')).display !== 'none');
    assert.equal((await stockage(page)).session, null);
    await page.reload({ waitUntil: 'networkidle0' });
    await attendreCategories(page);
    const apres = await etatFormulaire(page);
    assert.equal(apres.ecranAccueil, true);
    assert.equal(apres.niveau, null);
    assert.equal(apres.commentaire, '');
  } finally { await fermer(); }
});

test('une saisie mémorisée pour un autre QR n\'est jamais restaurée', { skip: SKIP }, async () => {
  const { page, fermer } = await ouvrir('QR-OK');
  try {
    await remplirNote(page, { commentaire: 'Pour QR-OK seulement' });
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.goto(`http://127.0.0.1:${PORT_CLIENT}/feedback/QR-AUTRE`, { waitUntil: 'networkidle0' });
    await attendreCategories(page);
    const apres = await etatFormulaire(page);
    assert.equal(apres.ecranAccueil, true);
    assert.equal(apres.commentaire, '');
    assert.equal(apres.niveau, null);
    assert.equal(apres.categorie, '');
  } finally { await fermer(); }
});

test('saisie périmée (plus de 30 minutes) : ignorée et effacée', { skip: SKIP }, async () => {
  const { page, fermer } = await ouvrir('QR-OK');
  try {
    await page.evaluate(() => sessionStorage.setItem('ikan.saisie.v1', JSON.stringify({ v: 1, qr: 'QR-OK', niveau: 'bien', categorieId: 'c1', commentaire: 'trop ancien', ts: Date.now() - 31 * 60 * 1000 })));
    await page.reload({ waitUntil: 'networkidle0' });
    await attendreCategories(page);
    const apres = await etatFormulaire(page);
    assert.equal(apres.ecranAccueil, true);
    assert.equal(apres.commentaire, '');
    assert.equal((await stockage(page)).session, null);
  } finally { await fermer(); }
});

test('stockage de session indisponible (navigation privée, stockage plein) : le formulaire fonctionne normalement', { skip: SKIP }, async () => {
  const bloquer = () => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('accès refusé', 'SecurityError'); }, configurable: true });
  };
  const { page, fermer } = await ouvrir('QR-OK', 360, { avant: bloquer });
  try {
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    posts.length = 0;
    await remplirNote(page);
    await page.tap('#btnSubmitFeedback');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('screen-success')).display !== 'none');
    assert.equal(posts.length, 1);
    assert.deepEqual(erreurs, []);
  } finally { await fermer(); }
});

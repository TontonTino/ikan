// Saisie conservée du formulaire « Noter l'expérience » (CL-04) et issue d'un envoi en échec réseau.
// Lancer : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLE_STOCKAGE, DUREE_VIE_MS, appliquerIssue, creerMemoireSaisie } from './saisie.ts';
import { interpreterEnvoi, messageEchecEnvoi } from './parcours.ts';

const T0 = 1_800_000_000_000;
const SAISIE = { niveau: 'bien', categorieId: 'c1', commentaire: 'Accueil rapide et souriant' };

/** Stockage factice : enregistre les appels pour prouver ce qui a (ou n'a pas) été touché. */
function stockageFactice({ casse = false } = {}) {
  const donnees = new Map();
  const appels = [];
  const s = {
    donnees, appels,
    getItem: (k) => { appels.push(['get', k]); if (casse) throw new Error('indisponible'); return donnees.has(k) ? donnees.get(k) : null; },
    setItem: (k, v) => { appels.push(['set', k]); if (casse) throw new DOMException('quota', 'QuotaExceededError'); donnees.set(k, String(v)); },
    removeItem: (k) => { appels.push(['remove', k]); if (casse) throw new Error('indisponible'); donnees.delete(k); },
  };
  return s;
}
const horloge = (t = T0) => { const h = { t, maintenant: () => h.t }; return h; };
function memoire(stockage = stockageFactice(), h = horloge(), extra = {}) {
  return { stockage, h, m: creerMemoireSaisie({ stockage: () => stockage, maintenant: h.maintenant, ...extra }) };
}

// ─────────────────────────── écriture, lecture, rechargement ───────────────────────────

test('la saisie écrite est relue à l\'identique, y compris par une nouvelle instance (rechargement de la page)', () => {
  const { stockage, h, m } = memoire();
  m.ecrire('QR-A', SAISIE);
  assert.deepEqual(m.lire('QR-A'), SAISIE);
  const apresRechargement = creerMemoireSaisie({ stockage: () => stockage, maintenant: h.maintenant });
  assert.deepEqual(apresRechargement.lire('QR-A'), SAISIE);
});

test('seules la note, la catégorie et le commentaire sont écrits : liste blanche exacte', () => {
  const { stockage, m } = memoire();
  m.ecrire('QR-A', SAISIE);
  const brut = JSON.parse(stockage.donnees.get(CLE_STOCKAGE));
  assert.deepEqual(Object.keys(brut).sort(), ['categorieId', 'commentaire', 'niveau', 'qr', 'ts', 'v']);
});

test('JAMAIS le contact ni le consentement : même si l\'appelant les passe, rien n\'est écrit', () => {
  const { stockage, m } = memoire();
  m.ecrire('QR-A', {
    ...SAISIE,
    telephone: '70123456', contact_telephone: '+22670123456', email: 'awa@example.org', souhaiteEtreRappele: true, consentement: true, consentement_contact: true,
  });
  const brut = stockage.donnees.get(CLE_STOCKAGE);
  for (const interdit of ['70123456', '22670123456', 'awa@example.org', 'telephone', 'email', 'consent', 'rappele', 'contact']) {
    assert.ok(!brut.toLowerCase().includes(interdit), `« ${interdit} » ne doit pas être stocké`);
  }
});

test('sessionStorage seulement : localStorage n\'est jamais touché', () => {
  const session = stockageFactice();
  const local = stockageFactice();
  const avant = { s: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), l: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') };
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  try {
    const m = creerMemoireSaisie();          // stockage par défaut
    m.ecrire('QR-A', SAISIE);
    assert.deepEqual(m.lire('QR-A'), SAISIE);
    m.effacer();
    assert.ok(session.appels.length >= 3, 'sessionStorage utilisé');
    assert.deepEqual(local.appels, [], 'localStorage jamais touché');
    assert.equal(local.donnees.size, 0);
  } finally {
    for (const [nom, d] of [['sessionStorage', avant.s], ['localStorage', avant.l]]) {
      if (d) Object.defineProperty(globalThis, nom, d); else delete globalThis[nom];
    }
  }
});

test('commentaire borné à 1000 caractères ; saisie entièrement vide = rien de mémorisé', () => {
  const { stockage, m } = memoire();
  m.ecrire('QR-A', { niveau: null, categorieId: null, commentaire: 'x'.repeat(5000) });
  assert.equal(m.lire('QR-A').commentaire.length, 1000);
  m.ecrire('QR-A', { niveau: null, categorieId: null, commentaire: '   ' });
  assert.equal(stockage.donnees.has(CLE_STOCKAGE), false);
  assert.equal(m.lire('QR-A'), null);
});

// ─────────────────────────── durée de vie (temps simulé) ───────────────────────────

test('durée de vie : 30 minutes après la dernière modification (temps simulé, aucune attente)', () => {
  assert.equal(DUREE_VIE_MS, 30 * 60 * 1000);
  const { stockage, h, m } = memoire();
  m.ecrire('QR-A', SAISIE);
  h.t = T0 + DUREE_VIE_MS;                                   // pile 30 min : encore valable
  assert.deepEqual(m.lire('QR-A'), SAISIE);
  h.t = T0 + DUREE_VIE_MS + 1;                               // 1 ms de plus : périmée et effacée
  assert.equal(m.lire('QR-A'), null);
  assert.equal(stockage.donnees.has(CLE_STOCKAGE), false);
});

test('chaque modification repousse l\'expiration de 30 minutes', () => {
  const { h, m } = memoire();
  m.ecrire('QR-A', SAISIE);
  h.t = T0 + 20 * 60_000;
  m.ecrire('QR-A', { ...SAISIE, commentaire: 'mis à jour' });
  h.t = T0 + 45 * 60_000;                                    // 25 min après la dernière écriture, 45 après la première
  assert.equal(m.lire('QR-A').commentaire, 'mis à jour');
});

test('durée configurable et horodatage du futur refusé', () => {
  const { h, m } = memoire(undefined, undefined, { dureeMs: 1000 });
  m.ecrire('QR-A', SAISIE);
  h.t = T0 + 1001;
  assert.equal(m.lire('QR-A'), null);
  const { stockage, h: h2, m: m2 } = memoire();
  m2.ecrire('QR-A', SAISIE);
  h2.t = T0 - 3_600_000;                                     // horloge revenue en arrière d'une heure
  assert.equal(m2.lire('QR-A'), null);
  assert.equal(stockage.donnees.has(CLE_STOCKAGE), false);
});

// ─────────────────────────── effacement après envoi, échec réseau ───────────────────────────

test('effacée après un envoi confirmé, conservée après tout échec', async () => {
  const { stockage, m } = memoire();
  m.ecrire('QR-A', SAISIE);
  appliquerIssue(m, { type: 'echec', cause: 'reseau', message: messageEchecEnvoi('reseau') });
  appliquerIssue(m, { type: 'telephone_invalide' });
  assert.deepEqual(m.lire('QR-A'), SAISIE);
  appliquerIssue(m, { type: 'succes', cree: { id: 'f1' } });
  assert.equal(m.lire('QR-A'), null);
  assert.equal(stockage.donnees.has(CLE_STOCKAGE), false);
});

test('chemin « Noter » en échec réseau : message non technique, avis pas parti, saisie conservée, réessai possible', async () => {
  const { m } = memoire();
  m.ecrire('QR-A', SAISIE);                                  // la personne a noté, choisi la catégorie et écrit son commentaire
  const coupure = async () => { throw new TypeError('Failed to fetch'); };
  const issue = await interpreterEnvoi(coupure);
  assert.equal(issue.type, 'echec');
  assert.equal(issue.cause, 'reseau');
  assert.match(issue.message, /^Pas de connexion/);
  assert.match(issue.message, /votre avis n'a pas été envoyé/);
  assert.match(issue.message, /appuyez de nouveau sur « Envoyer mon avis »/);
  assert.match(issue.message, /il ne sera enregistré qu'une fois/);
  assert.doesNotMatch(issue.message, /TypeError|fetch|HTTP|undefined|NetworkError|Error/);
  appliquerIssue(m, issue);
  assert.deepEqual(m.lire('QR-A'), SAISIE);                  // saisie conservée
  // le réseau revient : le même envoi réussit, la saisie est alors effacée
  const succes = await interpreterEnvoi(async () => ({ ok: true, status: 201, json: async () => ({ id: 'f1', nps_token: 'jeton' }) }));
  assert.equal(succes.type, 'succes');
  assert.equal(succes.cree.id, 'f1');
  appliquerIssue(m, succes);
  assert.equal(m.lire('QR-A'), null);
});

test('délai dépassé : message « peut-être pas envoyé », saisie conservée', async () => {
  const { m } = memoire();
  m.ecrire('QR-A', SAISIE);
  const delai = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  const issue = await interpreterEnvoi(delai);
  assert.equal(issue.cause, 'delai');
  assert.match(issue.message, /prend trop de temps/);
  assert.match(issue.message, /peut-être pas été envoyé/);
  appliquerIssue(m, issue);
  assert.deepEqual(m.lire('QR-A'), SAISIE);
});

test('erreurs HTTP : jamais confirmées, messages inchangés, 422 téléphone reconnu', async () => {
  const rep = (status, corps = {}) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => corps });
  assert.equal((await interpreterEnvoi(rep(500))).cause, 'serveur');
  assert.equal((await interpreterEnvoi(rep(404))).cause, 'qr_invalide');
  assert.equal((await interpreterEnvoi(rep(422, { detail: [{ loc: ['body', 'souhaite'], msg: 'x' }] }))).cause, 'saisie');
  assert.deepEqual(await interpreterEnvoi(rep(422, { detail: [{ loc: ['body', 'contact_telephone'], msg: 'x' }] })), { type: 'telephone_invalide' });
  const limite = await interpreterEnvoi(rep(429, { detail: 'Trop de demandes' }));
  assert.equal(limite.cause, 'trop_de_demandes');
  assert.match(limite.message, /Votre avis n'a pas été envoyé\.$/);
  assert.equal((await interpreterEnvoi(rep(201, null))).type, 'succes');
  for (const status of [400, 401, 403, 413, 500, 502, 503]) assert.notEqual((await interpreterEnvoi(rep(status))).type, 'succes', String(status));
});

// ─────────────────────────── autre QR, stockage indisponible, données invalides ───────────────────────────

test('la saisie d\'un autre QR n\'est jamais restaurée', () => {
  const { m } = memoire();
  m.ecrire('QR-A', SAISIE);
  assert.equal(m.lire('QR-B'), null);
  assert.deepEqual(m.lire('QR-A'), SAISIE);
  m.ecrire('QR-B', { niveau: 'mauvais', categorieId: 'c9', commentaire: 'autre agence' });
  assert.equal(m.lire('QR-A'), null);                        // une seule saisie à la fois : la nouvelle remplace l'ancienne
  assert.equal(m.lire('QR-B').niveau, 'mauvais');
});

test('stockage indisponible : aucune exception, le formulaire continue sans mémoire', () => {
  const cas = {
    'aucun stockage': creerMemoireSaisie({ stockage: () => null }),
    'accès qui lève (navigation privée)': creerMemoireSaisie({ stockage: () => { throw new DOMException('refusé', 'SecurityError'); } }),
    'lecture/écriture qui lèvent (stockage plein)': creerMemoireSaisie({ stockage: () => stockageFactice({ casse: true }) }),
  };
  for (const [nom, m] of Object.entries(cas)) {
    assert.doesNotThrow(() => m.ecrire('QR-A', SAISIE), nom);
    assert.equal(m.lire('QR-A'), null, nom);
    assert.doesNotThrow(() => m.effacer(), nom);
    assert.doesNotThrow(() => appliquerIssue(m, { type: 'succes', cree: null }), nom);
  }
  const defaut = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new DOMException('refusé', 'SecurityError'); }, configurable: true });
  try {
    const m = creerMemoireSaisie();
    assert.doesNotThrow(() => m.ecrire('QR-A', SAISIE));
    assert.equal(m.lire('QR-A'), null);
  } finally {
    if (defaut) Object.defineProperty(globalThis, 'sessionStorage', defaut); else delete globalThis.sessionStorage;
  }
});

test('contenu altéré ou invalide : ignoré, jamais d\'exception', () => {
  const { stockage, m } = memoire();
  const poser = (v) => stockage.donnees.set(CLE_STOCKAGE, typeof v === 'string' ? v : JSON.stringify(v));
  const base = { v: 1, qr: 'QR-A', niveau: 'bien', categorieId: 'c1', commentaire: 'ok', ts: T0 };
  poser('{pas du json'); assert.equal(m.lire('QR-A'), null);
  poser('null'); assert.equal(m.lire('QR-A'), null);
  poser({ ...base, v: 2 }); assert.equal(m.lire('QR-A'), null);
  poser({ ...base, ts: 'hier' }); assert.equal(m.lire('QR-A'), null);
  poser({ ...base, niveau: 'administrateur', categorieId: '<script>', commentaire: 42 }); assert.equal(m.lire('QR-A'), null);    // plus rien d'utilisable
  poser({ ...base, niveau: 'administrateur' }); assert.deepEqual(m.lire('QR-A'), { niveau: null, categorieId: 'c1', commentaire: 'ok' });
  poser({ ...base, categorieId: '../../etc/passwd' }); assert.equal(m.lire('QR-A').categorieId, null);
});

// Lancer : npm test  (node --test, sans dépendance ; Node >= 22.18 pour importer du .ts)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COMMENTAIRE,
  NIVEAUX,
  causeEchecHttp,
  construirePayload,
  etatQrDepuisStatut,
  extraireCodeQr,
  messageEchecEnvoi,
  nouvelleCleEnvoi,
  verifierSaisie,
} from './parcours.ts';

// ── code QR : jamais de repli sur une agence par défaut ──────────────────────────────

test('le code se lit dans /feedback/{code}, décodé et nettoyé', () => {
  assert.equal(extraireCodeQr('/feedback/QR-TUNIS-01', ''), 'QR-TUNIS-01');
  assert.equal(extraireCodeQr('/feedback/QR%20A%2FB', ''), 'QR A/B');
});

test('le paramètre ?qr= ou ?code= l\'emporte sur le chemin', () => {
  assert.equal(extraireCodeQr('/feedback', '?qr=QR-1'), 'QR-1');
  assert.equal(extraireCodeQr('/feedback/AUTRE', '?code=QR-2'), 'QR-2');
});

test('sans code : null (aucune agence par défaut, ni « QR-ORANGE-TUNIS-01 »)', () => {
  for (const [chemin, recherche] of [['/feedback', ''], ['/feedback/', ''], ['/', ''], ['/feedback', '?qr='], ['/feedback', '?qr=%20']]) {
    assert.equal(extraireCodeQr(chemin, recherche), null, `${chemin}${recherche}`);
  }
});

test('un code mal encodé ne plante pas et ne donne aucune agence', () => {
  assert.equal(extraireCodeQr('/feedback/%E0%A4%A', ''), null);
});

// ── cinq niveaux, aucun présélectionné ───────────────────────────────────────────────

test('cinq niveaux explicites, notes 1 à 5 croissantes', () => {
  const cles = Object.keys(NIVEAUX);
  assert.deepEqual(cles, ['mauvais', 'passable', 'neutre', 'bien', 'excellente']);
  assert.deepEqual(cles.map((c) => NIVEAUX[c].note), [1, 2, 3, 4, 5]);
  assert.deepEqual(cles.map((c) => NIVEAUX[c].label), ['Mauvais', 'Passable', 'Neutre', 'Bien', 'Excellente']);
});

test('sans note choisie, l\'envoi est refusé avec un message explicite', () => {
  const p = verifierSaisie({ niveau: null, categorieId: 'cat-1', souhaiteEtreRappele: false, telephone: '' });
  assert.equal(p.champ, 'note');
  assert.match(p.message, /note/i);
  assert.equal(verifierSaisie({ niveau: 'nimporte', categorieId: 'cat-1', souhaiteEtreRappele: false, telephone: '' }).champ, 'note');
});

// ── validations ──────────────────────────────────────────────────────────────────────

test('la catégorie est exigée avant la note', () => {
  assert.equal(verifierSaisie({ niveau: null, categorieId: null, souhaiteEtreRappele: false, telephone: '' }).champ, 'categorie');
});

test('commentaire facultatif : une saisie complète sans commentaire est valide', () => {
  assert.equal(verifierSaisie({ niveau: 'bien', categorieId: 'cat-1', souhaiteEtreRappele: false, telephone: '' }), null);
});

test('rappel demandé : téléphone obligatoire et format international explicite', () => {
  const base = { niveau: 'bien', categorieId: 'cat-1', souhaiteEtreRappele: true };
  assert.equal(verifierSaisie({ ...base, telephone: '  ' }).champ, 'telephone');
  assert.equal(verifierSaisie({ ...base, telephone: '123' }).champ, 'telephone');
  assert.equal(verifierSaisie({ ...base, telephone: '+33 6 12 34 56 78' }), null);
  assert.equal(verifierSaisie({ ...base, telephone: '70 12 34 56' }).champ, 'telephone');
});

test('le téléphone saisi mais le rappel refusé n\'est jamais envoyé', () => {
  const p = construirePayload({ niveau: 'bien', categorieId: 'cat-1', souhaiteEtreRappele: false, telephone: '+226 70 12 34 56', commentaire: '', cleEnvoi: 'cle-0000001' });
  assert.equal(p.contact_telephone, null);
  assert.equal(p.souhaite_etre_rappele, false);
});

// ── payload ──────────────────────────────────────────────────────────────────────────

test('payload : note, sentiment, catégorie et clé d\'idempotence', () => {
  const p = construirePayload({ niveau: 'mauvais', categorieId: 'cat-9', souhaiteEtreRappele: false, telephone: '', commentaire: '  Trop long  ', cleEnvoi: 'cle-envoi-0001' });
  assert.deepEqual(
    { note: p.note, sentiment: p.sentiment, categorie_id: p.categorie_id, commentaire: p.commentaire, idempotency_key: p.idempotency_key },
    { note: 1, sentiment: 'negatif', categorie_id: 'cat-9', commentaire: 'Trop long', idempotency_key: 'cle-envoi-0001' },
  );
});

test('commentaire vide ou espaces → null ; borné à 1000 caractères', () => {
  const base = { niveau: 'bien', categorieId: 'c', souhaiteEtreRappele: false, telephone: '', cleEnvoi: 'cle-0000002' };
  assert.equal(construirePayload({ ...base, commentaire: '   ' }).commentaire, null);
  assert.equal(MAX_COMMENTAIRE, 1000);
  assert.equal(construirePayload({ ...base, commentaire: 'x'.repeat(1500) }).commentaire.length, 1000);
});

test('construire un payload sans saisie valide est refusé (pas d\'envoi partiel)', () => {
  assert.throws(() => construirePayload({ niveau: null, categorieId: 'c', souhaiteEtreRappele: false, telephone: '', commentaire: '', cleEnvoi: 'cle-0000003' }));
});

// ── clé d'idempotence ────────────────────────────────────────────────────────────────

test('la clé respecte le format accepté par l\'API et change à chaque envoi', () => {
  const a = nouvelleCleEnvoi();
  const b = nouvelleCleEnvoi();
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a, b);
});

// ── erreurs : jamais de fausse confirmation ──────────────────────────────────────────

test('causes d\'échec selon le statut HTTP', () => {
  assert.equal(causeEchecHttp(404), 'qr_invalide');
  assert.equal(causeEchecHttp(429), 'trop_de_demandes');
  assert.equal(causeEchecHttp(422), 'saisie');
  assert.equal(causeEchecHttp(400), 'saisie');
  assert.equal(causeEchecHttp(500), 'serveur');
  assert.equal(causeEchecHttp(503), 'serveur');
});

test('chaque message d\'échec dit que l\'avis n\'a pas été envoyé (ou peut ne pas l\'avoir été) et ne confirme rien', () => {
  for (const cause of ['reseau', 'delai', 'qr_invalide', 'saisie', 'serveur']) {
    const m = messageEchecEnvoi(cause);
    assert.match(m, /n'a (peut-être )?pas|pas (pu )?(été )?envoy|n'a pas pu/i, cause);
    assert.doesNotMatch(m, /merci|bien été enregistré|transmis/i, cause);
  }
  assert.match(messageEchecEnvoi('reseau'), /une fois/);
});

test('validation du QR : 2xx valide, 404 invalide, le reste est « indisponible » (jamais « invalide » à tort)', () => {
  assert.equal(etatQrDepuisStatut(200), 'valide');
  assert.equal(etatQrDepuisStatut(404), 'invalide');
  assert.equal(etatQrDepuisStatut(500), 'indisponible');
  assert.equal(etatQrDepuisStatut(502), 'indisponible');
  assert.equal(etatQrDepuisStatut(null), 'indisponible');
});

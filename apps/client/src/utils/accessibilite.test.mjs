// Accessibilité du formulaire public : zones tactiles ≥ 44 px, contraste ≥ 4,5:1, clavier, police locale, champ piège.
// Lancer : npm test. Lecture statique de la feuille de style et du balisage de la page ([code].astro) : aucune dépendance,
// aucun navigateur. La mesure en situation réelle (navigateur) est décrite dans la PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { rapportContraste } from './contraste.ts';

const racine = new URL('../../', import.meta.url);
const page = readFileSync(new URL('src/pages/feedback/[code].astro', racine), 'utf8');
const layout = readFileSync(new URL('src/layouts/FeedbackLayout.astro', racine), 'utf8');
const css = page.slice(page.indexOf('<style>') + 7, page.indexOf('</style>'));
const balisage = page.slice(0, page.indexOf('<style>'));

// ── mini-lecteur CSS : règles « sélecteurs { déclarations } » dans l'ordre du fichier (les @media sont aplaties) ──
function lireRegles(texte) {
  const sansCommentaires = texte.replace(/\/\*[\s\S]*?\*\//g, '');
  const regles = [];
  for (const m of sansCommentaires.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selecteurs = m[1].split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x && !x.startsWith('@') && !/^(from|to|\d+%)$/.test(x));
    const declarations = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) declarations[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    if (selecteurs.length) regles.push({ selecteurs, declarations });
  }
  return regles;
}
const regles = lireRegles(css);

/** Valeur EFFECTIVE (dernière déclaration du fichier) d'une propriété pour un sélecteur exact. */
function effective(selecteur, propriete) {
  let valeur = null;
  for (const r of regles) if (r.selecteurs.includes(selecteur) && propriete in r.declarations) valeur = r.declarations[propriete];
  return valeur;
}
const px = (v) => (v && /^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : null);

// ── zones tactiles ───────────────────────────────────────────────────────────────────

const CONTROLES = {
  '.sentiment-tile': 'les 5 niveaux de note',
  '.segment': 'Oui / Non',
  '.mic-btn': 'le micro',
  '.btn-secondary': 'Réessayer, Donner un autre avis, Partager une idée',
  '.btn-submit': 'Envoyer mon avis',
  '.styled-input': 'champ téléphone',
  '.styled-select': 'liste des catégories',
  '.styled-textarea': 'commentaire',
  '.consent-row': 'ligne de la case de consentement',
  '.consent-box': 'case de consentement',
  '.lien-retour': 'lien « Retour » du formulaire d\'idée',
};

test('toutes les zones tactiles font au moins 44 × 44 px (largeur ET hauteur déclarées)', () => {
  for (const [selecteur, role] of Object.entries(CONTROLES)) {
    const h = px(effective(selecteur, 'min-height'));
    assert.ok(h !== null && h >= 44, `${role} (${selecteur}) : min-height = ${effective(selecteur, 'min-height')}`);
    if (selecteur !== '.consent-row') {
      const l = px(effective(selecteur, 'min-width'));
      assert.ok(l !== null && l >= 44, `${role} (${selecteur}) : min-width = ${effective(selecteur, 'min-width')}`);
    }
  }
});

test('Oui/Non et le micro en particulier : 44 px, et aucune règle ultérieure ne les réduit', () => {
  for (const s of ['.segment', '.mic-btn']) {
    assert.ok(px(effective(s, 'min-height')) >= 44 && px(effective(s, 'min-width')) >= 44, s);
    assert.equal(effective(s, 'height') === null || px(effective(s, 'height')) >= 44, true, `${s} height`);
  }
});

test('chaque bouton / champ du balisage est couvert par une règle ≥ 44 px (aucun contrôle oublié)', () => {
  const couvertes = new Set(Object.keys(CONTROLES).filter((c) => c.startsWith('.') && !c.includes(' ')).map((c) => c.slice(1)));
  const EXEMPTES = new Set(['champSiteWeb', 'champIdeeSiteWeb']); // piège hors écran, hors parcours clavier
  const manques = [];
  for (const m of balisage.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    if (id && EXEMPTES.has(id)) continue;
    const classes = ((attrs.match(/\bclass="([^"]+)"/) || [])[1] || '').split(/\s+/);
    if (!classes.some((c) => couvertes.has(c))) manques.push(`${m[1]}#${id || '?'} class="${classes.join(' ')}"`);
  }
  assert.deepEqual(manques, []);
});

test('la case de consentement : zone de 44 px, libellé relié à la case, texte rempli par la configuration', () => {
  assert.match(balisage, /<label class="consent-row" for="consentCheckbox">/);
  assert.match(balisage, /<input type="checkbox" id="consentCheckbox" class="consent-box"/);
  assert.match(balisage, /<span id="consentText"><\/span>/); // aucune durée écrite en dur dans le balisage
  assert.doesNotMatch(balisage, /conservé \d+ mois/);
});

// ── contraste ────────────────────────────────────────────────────────────────────────

// Les couleurs de la feuille sont des jetons (var(--…)) : on suit l'alias jusqu'à la valeur hexadécimale du :root de
// FeedbackLayout. Une couleur écrite en dur, ou un jeton inconnu, fait échouer le test.
const racineCss = layout.slice(layout.indexOf(':root'), layout.indexOf('}', layout.indexOf(':root')));
function jeton(nom, profondeur = 0) {
  assert.ok(profondeur < 8, `alias circulaire : ${nom}`);
  const m = racineCss.match(new RegExp(`${nom}:\\s*([^;]+);`));
  assert.ok(m, `jeton introuvable dans FeedbackLayout : ${nom}`);
  return resoudre(m[1].trim(), profondeur + 1);
}
function resoudre(valeur, profondeur = 0) {
  if (!valeur) return valeur;
  const alias = valeur.trim().match(/^var\((--[\w-]+)\)$/);
  if (alias) return jeton(alias[1], profondeur);
  return valeur.trim();
}
const couleur = (selecteur) => resoudre(effective(selecteur, 'color'));
const fond = (selecteur) => resoudre(effective(selecteur, 'background') ?? effective(selecteur, 'background-color'));
const BLANC = jeton('--color-surface');

test('aucune couleur écrite en dur ni dégradé dans la feuille du formulaire : tout passe par les jetons', () => {
  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(sansCommentaires.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|gradient\(/g) ?? [], []);
});

test('bandeau et bouton d\'envoi : fond plein, texte blanc ≥ 4,5:1 (au repos et au survol)', () => {
  assert.equal(fond('.hero'), jeton('--color-encre'));
  assert.equal(fond('.btn-submit'), jeton('--color-accent'), 'une seule action d\'accent : Envoyer');
  assert.ok(rapportContraste(couleur('.hero-title'), fond('.hero')) >= 4.5);
  assert.ok(rapportContraste(couleur('.btn-submit'), fond('.btn-submit')) >= 4.5);
  assert.ok(rapportContraste(couleur('.btn-submit'), fond('.btn-submit:hover')) >= 4.5);
});

// [description, couleur du texte, fond]. Couleurs ET fonds lus dans la feuille (jetons résolus).
const PAIRES = [
  ['libellés des champs', couleur('.field-label'), BLANC],
  ['question Oui/Non', couleur('.field-label-inline'), BLANC],
  ['texte saisi (champ, liste, commentaire)', couleur('.styled-input'), fond('.styled-input')],
  ['texte de la liste', couleur('.styled-select'), BLANC],
  ['titre du bandeau', couleur('.hero-title'), fond('.hero')],
  ['sous-titre du bandeau', couleur('.hero-sub'), fond('.hero')],
  ['pastille d\'agence sur le bandeau', couleur('.agency-chip'), fond('.hero')],
  ['numéro d\'étape', couleur('.section-step-num'), fond('.section-step-num')],
  ['« (facultatif) »', couleur('.optional'), BLANC],
  ['compteur de caractères', couleur('.char-count'), fond('.textarea-footer')],
  ['placeholders', effective('.styled-input::placeholder', 'color') && resoudre(effective('.styled-input::placeholder', 'color')), BLANC],
  ['placeholders (liste désactivée)', resoudre(effective('.styled-input::placeholder', 'color')), fond('.styled-select:disabled')],
  ['libellé d\'un niveau non choisi', couleur('.tile-label'), fond('.sentiment-tile')],
  ['libellé d\'un niveau survolé', couleur('.tile-label'), fond('.sentiment-tile:hover')],
  ['libellé du niveau choisi', couleur('.sentiment-tile.selected .tile-label'), fond('.sentiment-tile.selected')],
  ['micro', couleur('.mic-btn'), fond('.mic-btn')],
  ['micro survolé', couleur('.mic-btn'), fond('.mic-btn:hover')],
  ['micro en cours d\'enregistrement', couleur('.mic-btn.recording'), fond('.mic-btn.recording')],
  ['Non (inactif)', couleur('.segment'), fond('.segmented-control')],
  ['Oui / Non actif', couleur('.segment.is-active'), fond('.segment.is-active')],
  ['messages d\'erreur (fond blanc)', couleur('.field-error'), BLANC],
  ['messages d\'erreur (panneau de recontact)', couleur('.field-error'), fond('.reveal-panel')],
  ['dictée vocale', couleur('.voice-status-bar'), BLANC],
  ['dictée vocale : erreur', couleur('.voice-status-bar.is-error'), BLANC],
  ['note de confidentialité', couleur('.lock-note'), BLANC],
  ['titre de remerciement', couleur('.success-title'), BLANC],
  ['message de remerciement', couleur('.success-message'), BLANC],
  ['pastille « Transmis en direct »', couleur('.success-status-pill'), fond('.success-status-pill')],
  ['« Réessayer » / « Donner un autre avis » / « Partager une idée »', couleur('.btn-secondary'), fond('.btn-secondary')],
  ['les mêmes, survolés', couleur('.btn-secondary:hover'), fond('.btn-secondary:hover')],
  ['texte de consentement (panneau de recontact)', couleur('.consent-row'), fond('.reveal-panel')],
  ['texte de consentement (fond blanc)', couleur('.consent-row'), BLANC],
  ['lien « Retour »', couleur('.lien-retour'), BLANC],
  ['écran d\'état : titre', couleur('.state-title'), BLANC],
  ['écran d\'état : texte', couleur('.state-text'), BLANC],
  ['QR non reconnu : titre', couleur('.error-screen h2'), BLANC],
  ['QR non reconnu : texte', couleur('.error-screen p'), BLANC],
];

test('rapport de contraste ≥ 4,5:1 pour tout le texte du formulaire', () => {
  const trop_faibles = [];
  for (const [nom, fg, bg] of PAIRES) {
    assert.ok(fg && bg, `couleur introuvable dans la feuille pour « ${nom} »`);
    const r = rapportContraste(fg, bg.split(' ')[0]);
    if (r < 4.5) trop_faibles.push(`${nom} : ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(trop_faibles, []);
});

test('contours des champs, boutons et cases : ≥ 3:1 (élément graphique)', () => {
  for (const [s, p] of [['.styled-input', 'border'], ['.styled-select', 'border'], ['.textarea-box', 'border'], ['.mic-btn', 'border'], ['.btn-secondary', 'border'], ['.consent-case', 'border']]) {
    const c = resoudre((effective(s, p) || '').split(' ').pop());
    assert.ok(rapportContraste(c, BLANC) >= 3, `${s} : contour ${c}`);
  }
});

test('l\'icône du champ téléphone atteint 3:1 (élément graphique)', () => {
  assert.ok(rapportContraste(couleur('.field-icon'), BLANC) >= 3);
});

test('le calcul de contraste est exact (valeurs de référence WCAG)', () => {
  assert.equal(rapportContraste('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(rapportContraste('#767676', '#FFFFFF').toFixed(2), '4.54');
  assert.equal(rapportContraste('#FFFFFF', '#FFFFFF').toFixed(1), '1.0');
});

// ── clavier, libellés, champ piège ───────────────────────────────────────────────────

test('niveaux : une seule tabulation d\'entrée (tabindex itinérant) et libellé « Excellent » au masculin', () => {
  const niveaux = [...balisage.matchAll(/<button[^>]*class="sentiment-tile[^>]*>/g)].map((m) => m[0]);
  assert.equal(niveaux.length, 5);
  assert.deepEqual(niveaux.map((n) => (n.match(/tabindex="(-?\d)"/) || [])[1]), ['0', '-1', '-1', '-1', '-1']);
  assert.ok(niveaux.every((n) => /role="radio"/.test(n) && /aria-checked="false"/.test(n)), 'aucun niveau présélectionné');
  assert.match(balisage, /<span class="tile-label">Excellent<\/span>/);
  assert.doesNotMatch(balisage, /Excellente/);
  assert.match(balisage, /role="radiogroup"/);
});

test('envoi sans note : zone d\'erreur annoncée (role="alert") reliée au groupe de notes', () => {
  assert.match(balisage, /<p class="field-error" id="ratingError" role="alert" hidden><\/p>/);
  assert.match(balisage, /aria-describedby="ratingHint ratingError"/);
});

test('compteur : « caractères restants sur 1000 » dans le balisage et relié au champ', () => {
  assert.match(balisage, /<span class="char-count" id="charCount">1000 caractères restants sur 1000<\/span>/);
  assert.match(balisage, /id="inputCommentaire"[\s\S]*?aria-describedby="charCount"/);
  assert.match(balisage, /maxlength="1000"/);
});

test('champ piège : hors parcours clavier, invisible aux lecteurs d\'écran, hors écran', () => {
  assert.match(balisage, /<div class="champ-piege" aria-hidden="true">/);
  assert.match(balisage, /<input type="text" id="champSiteWeb" name="website" tabindex="-1" autocomplete="off" \/>/);
  assert.ok((effective('.champ-piege', 'left') || '').startsWith('-'), 'positionné hors écran');
});

test('le formulaire ne demande que le téléphone : ni nom ni e-mail', () => {
  assert.equal([...balisage.matchAll(/<input[^>]*>/g)].some((m) => /type="email"|name="nom"|name="email"/.test(m[0])), false);
  assert.match(balisage, /type="tel"/);
});

// ── police locale, aucun appel à Google ──────────────────────────────────────────────

test('Poppins est hébergée localement (latin, font-display: swap) et Google Fonts n\'est plus appelé', () => {
  assert.doesNotMatch(layout, /fonts\.googleapis|fonts\.gstatic/);
  for (const w of [400, 600]) {
    assert.ok(existsSync(new URL(`public/fonts/poppins-latin-${w}-normal.woff2`, racine)), `fichier ${w}`);
    assert.match(layout, new RegExp(`font-weight: ${w};\\s*font-display: swap;\\s*src: url\\('/fonts/poppins-latin-${w}-normal\\.woff2'\\) format\\('woff2'\\)`));
  }
  assert.match(layout, /unicode-range: U\+0000-00FF/);
  // Deux graisses seulement (lot 2c, comme le dashboard) : plus de fichier ni de @font-face 500 / 700 / 800.
  for (const w of [500, 700, 800]) {
    assert.ok(!existsSync(new URL(`public/fonts/poppins-latin-${w}-normal.woff2`, racine)), `fichier ${w} encore présent`);
    assert.doesNotMatch(layout, new RegExp(`font-weight: ${w};`));
  }
  const graisses = [...css.matchAll(/font-weight:\s*([^;]+);/g)].map((m) => resoudre(m[1]));
  assert.deepEqual([...new Set(graisses)].sort(), ['400', '600']);
  assert.doesNotMatch(page, /googleapis|gstatic/);
});

test('focus clavier visible sur tous les contrôles, et l’attribut hidden l’emporte (Réessayer, recontact)', () => {
  for (const s of ['.sentiment-tile:focus-visible', '.segment:focus-visible', '.mic-btn:focus-visible', '.btn-submit:focus-visible', '.btn-secondary:focus-visible', '.styled-select:focus-visible', '.styled-textarea:focus-visible', '.styled-input:focus-visible', '.consent-box:focus-visible + .consent-case']) {
    const contour = effective(s, 'outline') || '';
    assert.match(contour, /^3px solid /, s);
    const c = resoudre(contour.replace(/^3px solid /, ''));
    assert.ok(rapportContraste(c, BLANC) >= 3 && rapportContraste(c, jeton('--color-bg')) >= 3, `${s} : ${c}`);
  }
  assert.equal(effective('.btn-secondary[hidden]', 'display'), 'none');
  assert.equal(effective('.recontact-section[hidden]', 'display'), 'none');
});

// ── parcours « Partager une idée » ───────────────────────────────────────────────────

const section = (id) => {
  const debut = balisage.indexOf(`<section id="${id}"`);
  assert.ok(debut >= 0, `section ${id}`);
  return balisage.slice(debut, balisage.indexOf('</section>', debut));
};

test('plus d\'écran de choix : le formulaire noté s\'affiche d\'entrée, l\'idée est proposée après l\'envoi', () => {
  assert.doesNotMatch(balisage, /id="screen-accueil"|btnChoixNote|btnChoixIdee/);
  assert.match(balisage, /<section id="screen-sentiment" class="screen-view">/); // premier écran affiché, sans display:none
  assert.match(section('screen-success'), /id="btnSuccesIdee"[\s\S]*Partager une idée/);
  assert.match(section('screen-idee-merci'), /id="btnIdeeNouvelAvis"[\s\S]*Donner un autre avis/);
});

test('plus de question NPS après l\'envoi, ni d\'appel à /nps', () => {
  assert.doesNotMatch(section('screen-success'), /nps|recommanderiez/i);
  assert.doesNotMatch(page, /\/nps`|nps_note|afficherQuestionNPS/);
});

test('le formulaire d\'idée : un seul champ texte, 1000 caractères, compteur, retour, aucun contact', () => {
  const idee = section('screen-idee');
  assert.equal([...idee.matchAll(/<textarea\b/g)].length, 1);
  assert.match(idee, /id="inputIdee"[\s\S]*maxlength="1000"/);
  assert.match(idee, /id="ideeCharCount">1000 caractères restants sur 1000</);
  assert.match(idee, /id="btnRetourIdee"/);
  assert.match(idee, /id="btnSubmitIdee"/);
  // aucun champ de contact ni consentement : seuls le texte et le champ piège (caché) existent
  const champs = [...idee.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(champs.length, 1);
  assert.match(champs[0], /id="champIdeeSiteWeb"[^>]*tabindex="-1"/);
  assert.doesNotMatch(idee, /type="tel"|type="email"|checkbox|consent|téléphone|e-mail/i);
});

test('le parcours complet tient en 4 écrans au plus et la confirmation rassure', () => {
  const ecrans = [...balisage.matchAll(/<section id="(screen-(?:accueil|idee|idee-merci|sentiment|success))"/g)].map((m) => m[1]);
  assert.deepEqual(ecrans.sort(), ['screen-idee', 'screen-idee-merci', 'screen-sentiment', 'screen-success']);
  assert.ok(ecrans.length <= 4);
  assert.match(section('screen-idee-merci'), /Merci pour votre idée !/);
  assert.match(section('screen-idee-merci'), /a bien été transmise à l'agence/);
});

test('« Votre avis est confidentiel. » remplace « Avis strictement anonyme et sécurisé » partout dans le client', () => {
  assert.match(balisage, /<span>Votre avis est confidentiel\.<\/span>/);
  assert.doesNotMatch(page + layout, /anonyme/i);
});

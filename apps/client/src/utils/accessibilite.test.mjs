// Accessibilité du formulaire public : zones tactiles ≥ 44 px, contraste ≥ 4,5:1, clavier, police locale, champ piège.
// Lancer : npm test. Lecture statique de la feuille de style et du balisage de la page ([code].astro) : aucune dépendance,
// aucun navigateur. La mesure en situation réelle (navigateur) est décrite dans la PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { rapportContraste, melanger, lireCouleur } from './contraste.ts';

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
  '.btn-secondary': 'Réessayer, Donner un autre avis',
  '.btn-submit': 'Envoyer mon avis',
  '.nps-skip-link': 'Passer (NPS)',
  '.nps-scale :global(.nps-btn)': 'notes NPS 0 à 10',
  '.styled-input': 'champ téléphone',
  '.styled-select': 'liste des catégories',
  '.styled-textarea': 'commentaire',
  '.consent-row': 'ligne de la case de consentement',
  '.consent-box': 'case de consentement',
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
  const EXEMPTES = new Set(['champSiteWeb']); // piège hors écran, hors parcours clavier
  const manques = [];
  for (const m of balisage.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    if (id && EXEMPTES.has(id)) continue;
    const classes = ((attrs.match(/\bclass="([^"]+)"/) || [])[1] || '').split(/\s+/);
    if (!classes.some((c) => couvertes.has(c))) manques.push(`${m[1]}#${id || '?'} class="${classes.join(' ')}"`);
  }
  assert.deepEqual(manques, []);
  // Les boutons NPS sont créés par script : la règle existe (testée plus haut) et le script leur donne cette classe.
  assert.match(page, /btn\.className = 'nps-btn'/);
});

test('la case de consentement : zone de 44 px, libellé relié à la case, texte rempli par la configuration', () => {
  assert.match(balisage, /<label class="consent-row" for="consentCheckbox">/);
  assert.match(balisage, /<input type="checkbox" id="consentCheckbox" class="consent-box"/);
  assert.match(balisage, /<span id="consentText"><\/span>/); // aucune durée écrite en dur dans le balisage
  assert.doesNotMatch(balisage, /conservé \d+ mois/);
});

// ── contraste ────────────────────────────────────────────────────────────────────────

const HERO_CLAIR = '#2F6A2B'; // point le plus clair du dégradé du bandeau et du bouton d'envoi

test('le dégradé du bandeau et du bouton d\'envoi ne dépasse pas le vert #2F6A2B', () => {
  for (const s of ['.hero', '.btn-submit']) {
    const fond = effective(s, 'background');
    const stops = [...fond.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0]);
    assert.ok(stops.length >= 2, s);
    for (const c of stops) assert.ok(rapportContraste('#FFFFFF', c) >= 4.5, `${s} : blanc sur ${c}`);
  }
});

// [description, couleur du texte, fond]. Les couleurs sont lues dans la feuille quand une règle les porte.
const couleur = (selecteur) => effective(selecteur, 'color');
const PAIRES = [
  ['libellés des champs', couleur('.field-label'), '#FFFFFF'],
  ['texte saisi (champ, liste, commentaire)', couleur('.styled-input'), '#FFFFFF'],
  ['titre du bandeau', couleur('.hero-title'), HERO_CLAIR],
  ['sous-titre du bandeau (blanc à 85 %)', melanger([255, 255, 255], lireCouleur(HERO_CLAIR), 0.85), HERO_CLAIR],
  ['pastille d\'agence sur le bandeau', couleur('.agency-chip'), melanger([255, 255, 255], lireCouleur(HERO_CLAIR), 0.12)],
  ['« (facultatif) »', couleur('.optional'), '#FFFFFF'],
  ['compteur de caractères', effective('.char-count', 'color'), '#FFFFFF'],
  ['placeholders', effective('.styled-input::placeholder', 'color'), '#FFFFFF'],
  ['placeholders (liste, fond crème)', effective('.styled-input::placeholder', 'color'), '#FAFCF9'],
  ['libellé d\'un niveau non choisi', couleur('.tile-label'), '#F8FAFC'],
  ['niveau choisi : Mauvais', effective('.sentiment-tile.selected.tone-mauvais .tile-label', 'color'), '#FEF2F2'],
  ['niveau choisi : Passable', effective('.sentiment-tile.selected.tone-passable .tile-label', 'color'), '#FFF7ED'],
  ['niveau choisi : Neutre', effective('.sentiment-tile.selected.tone-neutre .tile-label', 'color'), '#FEFCE8'],
  ['niveau choisi : Bien', effective('.sentiment-tile.selected.tone-bien .tile-label', 'color'), '#F0FDF4'],
  ['niveau choisi : Excellent', effective('.sentiment-tile.selected.tone-excellente .tile-label', 'color'), '#ECFDF5'],
  ['micro', couleur('.mic-btn'), effective('.mic-btn', 'background')],
  ['micro en cours d\'enregistrement', '#FFFFFF', effective('.mic-btn.recording', 'background')],
  ['Non (inactif)', effective('.segment', 'color'), '#F1F5F0'],
  ['Oui / Non actif', couleur('.segment.is-active'), effective('.segment.is-active', 'background')],
  ['messages d\'erreur (fond blanc)', couleur('.field-error'), '#FFFFFF'],
  ['messages d\'erreur (panneau gris)', couleur('.field-error'), '#F8FAFC'],
  ['dictée vocale', couleur('.voice-status-bar'), '#FFFFFF'],
  ['dictée vocale : erreur', couleur('.voice-status-bar.is-error'), '#FFFFFF'],
  ['note de confidentialité', couleur('.lock-note'), '#FFFFFF'],
  ['message de remerciement', couleur('.success-message'), '#FFFFFF'],
  ['pastille « Transmis en direct »', couleur('.success-status-pill'), effective('.success-status-pill', 'background')],
  ['question NPS', couleur('.nps-question'), '#FFFFFF'],
  ['agence dans la question NPS', couleur('.nps-question strong'), '#FFFFFF'],
  ['échelle NPS', couleur('.nps-scale :global(.nps-btn)'), '#FFFFFF'],
  ['échelle NPS survolée', couleur('.nps-scale :global(.nps-btn):hover'), effective('.nps-scale :global(.nps-btn):hover', 'background')],
  ['libellés des extrémités NPS', couleur('.nps-scale-labels'), '#FFFFFF'],
  ['« Passer »', couleur('.nps-skip-link'), '#FFFFFF'],
  ['« Réessayer » / « Donner un autre avis »', couleur('.btn-secondary'), '#F8FAFC'],
  ['texte de consentement', couleur('.consent-row'), '#F8FAFC'],
  ['texte de consentement (fond blanc)', couleur('.consent-row'), '#FFFFFF'],
];

test('rapport de contraste ≥ 4,5:1 pour tout le texte du formulaire', () => {
  const trop_faibles = [];
  for (const [nom, fg, bg] of PAIRES) {
    assert.ok(fg && bg, `couleur introuvable dans la feuille pour « ${nom} »`);
    const fond = typeof bg === 'string' && bg.startsWith('#') ? bg.slice(0, 7) : bg;
    const r = rapportContraste(fg, fond);
    if (r < 4.5) trop_faibles.push(`${nom} : ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(trop_faibles, []);
});

test('l\'icône du champ téléphone atteint 3:1 (élément graphique)', () => {
  assert.ok(rapportContraste(effective('.field-icon', 'color'), '#FFFFFF') >= 3);
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
  for (const w of [400, 500, 600, 700, 800]) {
    assert.ok(existsSync(new URL(`public/fonts/poppins-latin-${w}-normal.woff2`, racine)), `fichier ${w}`);
    assert.match(layout, new RegExp(`font-weight: ${w};\\s*font-display: swap;\\s*src: url\\('/fonts/poppins-latin-${w}-normal\\.woff2'\\) format\\('woff2'\\)`));
  }
  assert.match(layout, /unicode-range: U\+0000-00FF/);
  assert.doesNotMatch(page, /googleapis|gstatic/);
});

test('focus clavier visible sur tous les contrôles, et l’attribut hidden l’emporte (Réessayer, recontact)', () => {
  for (const s of ['.sentiment-tile:focus-visible', '.segment:focus-visible', '.mic-btn:focus-visible', '.btn-submit:focus-visible', '.btn-secondary:focus-visible', '.styled-select:focus-visible', '.styled-textarea:focus-visible', '.styled-input:focus-visible', '.consent-box:focus-visible + .consent-case']) {
    assert.match(effective(s, 'outline') || '', /^3px solid #/, s);
  }
  assert.equal(effective('.btn-secondary[hidden]', 'display'), 'none');
  assert.equal(effective('.recontact-section[hidden]', 'display'), 'none');
});

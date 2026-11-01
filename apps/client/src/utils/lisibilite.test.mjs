// Règles de mise en page du formulaire (CL-07) lues dans [code].astro : étiquettes des niveaux ≥ 12 px, pastille d'agence sans coupure.
// Les mesures en vrai navigateur (320 / 360 / 412 px) sont dans src/e2e/saisie-lisibilite.test.mjs.
// Lancer : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../pages/feedback/[code].astro', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const style = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));

/** Toutes les règles `selecteur { … }` dont le sélecteur est exactement `nom` (hors imbrication @media comprise : on lit tout le fichier). */
function regles(nom) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(style))) {
    const sels = m[1].split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim());
    if (sels.includes(nom)) out.push(m[2]);
  }
  return out;
}
const valeur = (corps, prop) => (corps.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`)) || [])[1]?.trim();
const enPx = (v) => (v?.endsWith('rem') ? parseFloat(v) * 16 : v?.endsWith('px') ? parseFloat(v) : NaN);

test('étiquettes des cinq niveaux : 12 px au minimum à toute largeur (avant : 10,9 px), jamais de clamp qui redescend', () => {
  const tailles = regles('.tile-label').map((c) => valeur(c, 'font-size')).filter(Boolean);
  assert.ok(tailles.length >= 2, 'taille de base + 13 px dès 400 px');
  for (const t of tailles) {
    assert.ok(!t.startsWith('clamp'), `${t} : plus de clamp (le minimum était 0,68 rem)`);
    assert.ok(enPx(t) >= 12, `${t} = ${enPx(t)} px < 12 px`);
  }
  assert.ok(tailles.some((t) => enPx(t) >= 13), '13 px sur les écrans de 400 px et plus');
});

test('étiquettes : resserrées sous 380 px et grille élargie à 320 px pour que « Excellent » tienne sans défilement', () => {
  const corps = regles('.tile-label').join('\n');
  assert.match(corps, /letter-spacing:\s*-0\.02em/);
  const grille = regles('.sentiment-grid').join('\n');
  assert.match(grille, /margin-left:\s*-10px/);
  assert.match(grille, /margin-right:\s*-10px/);
});

test('zones tactiles des niveaux : ni hauteur ni largeur minimales retirées', () => {
  // La règle des 44 px est verrouillée par accessibilite.test.mjs ; on vérifie ici que cette PR ne la contourne pas.
  const tuile = regles('.sentiment-tile').join('\n');
  assert.doesNotMatch(tuile, /max-height|(?<![-\w])(height|width)\s*:\s*\d{1,2}px/);
});

test('pastille d\'agence : le nom complet passe à la ligne au lieu d\'être coupé', () => {
  const pastille = regles('.agency-chip').join('\n');
  assert.doesNotMatch(pastille, /white-space:\s*nowrap/);
  assert.match(pastille, /white-space:\s*normal/);
  assert.match(pastille, /max-width:\s*100%/);
  assert.match(pastille, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(pastille, /max-width:\s*60%/);
  assert.doesNotMatch(pastille, /text-overflow:\s*ellipsis/);
  assert.match(regles('#agencyBadgeText').join('\n'), /min-width:\s*0/);
});

test('bandeau : la pastille descend sur une 2e ligne si le nom est trop long, sinon reste à côté du logo', () => {
  const bandeau = regles('.hero-top').join('\n');
  assert.match(bandeau, /display:\s*flex/);
  assert.match(bandeau, /flex-wrap:\s*wrap/);
  assert.match(bandeau, /justify-content:\s*space-between/);
  assert.match(regles('.agency-chip').join('\n'), /margin-left:\s*auto/);
});

test('le nom de l\'agence reste un seul élément (accessibilité) et son texte n\'est jamais tronqué par le code', () => {
  assert.match(source, /<span id="agencyBadgeText">\{agenceInfo\?\.agence_nom \|\| 'AGENCE EN DIRECT'\}<\/span>/);
  assert.doesNotMatch(source, /agence_nom[^;\n]*\.(slice|substring|substr)\(/);
});

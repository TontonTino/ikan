import { describe, expect, it } from 'vitest';
import source from './AdminAgencesContent.tsx?raw';
// @ts-ignore — pas de types Node dans ce projet (même convention que styles/contraste.test.ts).
import { readFileSync } from 'node:fs';

// Les feuilles CSS ne passent pas par « ?raw » dans vitest : lecture directe, comme styles/contraste.test.ts.
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

/** Fiche d'agence (lot 6) : vérifiée sur le source, la page chargeant ses données depuis l'API. */
describe('gestion des agences : actions d’une fiche', () => {
  it('chaque bouton « Modifier » nomme son objet ; plus aucun « Modifier » nu', () => {
    expect(source).toContain('Modifier le responsable');
    expect(source).toContain('Modifier l’agence');
    expect(source).not.toMatch(/>\s*Modifier\s*</);
  });

  it('« Désactiver l’agence » est seule dans sa zone, séparée des actions courantes par un trait et un espace', () => {
    const actions = source.indexOf('className="fiche-agence__actions"');
    const zone = source.indexOf('className="fiche-agence__zone-sensible"');
    const desactiver = source.indexOf('Désactiver l’agence');
    expect(actions).toBeGreaterThan(-1);
    expect(zone).toBeGreaterThan(actions);
    expect(desactiver).toBeGreaterThan(zone);
    // Aucune action courante dans la zone sensible.
    const blocZone = source.slice(zone, source.indexOf('</div>', zone));
    expect(blocZone).not.toMatch(/Modifier|Catégories|QR Code/);
    expect(css).toMatch(/\.fiche-agence__zone-sensible \{[^}]*margin-top: var\(--space-4\)[^}]*border-top: 1px solid var\(--color-trait\)/);
  });

  it('désactiver passe par une confirmation qui nomme l’agence ; réactiver reste direct', () => {
    expect(source).toMatch(/if \(a\.active !== false\) \{\s*setErreurConfirmation\(''\);\s*setConfirmation\(\{ type: 'agence', agence: a \}\);\s*return;/);
    expect(source).toMatch(/title="Désactiver cette agence \?"\s*subject=\{confirmation\.agence\.nom\}/);
    expect(source).toContain('Réactiver l’agence');
  });
});

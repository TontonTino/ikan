// @ts-ignore — pas de types Node dans ce projet (même convention que styles/contraste.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css: string = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('la carte reste sous les menus', () => {
  it('les couches de Leaflet (200 à 1000) sont cloisonnées dans la carte', () => {
    const regle = css.match(/\.leaflet-container\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(regle).toMatch(/isolation:\s*isolate/);
    expect(regle).toMatch(/z-index:\s*0/);
  });
});

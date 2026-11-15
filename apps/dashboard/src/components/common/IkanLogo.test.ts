import { describe, expect, it } from 'vitest';
import { SOURCES_LOGO, sourceLogo } from './IkanLogo';
import sourceConnexion from '../../pages/LoginPage.tsx?raw';
import sourceMenu from '../layout/Sidebar.tsx?raw';

const SOURCES = import.meta.glob(['/src/**/*.tsx', '/src/**/*.ts', '/src/**/*.css', '!/src/**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('logos : uniquement les variantes officielles', () => {
  it('fond foncé (menu) : logo horizontal blanc, cube blanc une fois replié', () => {
    expect(sourceLogo('light', true)).toBe('/ikanai-logo-horizontal-white.png');
    expect(sourceLogo('light', false)).toBe('/ikanai-mark-white.png');
    expect(sourceMenu).toContain('<IkanLogo variant="light" size={28} showText={!collapsed} />');
  });

  it('fond clair : logo horizontal, cube seul sans texte', () => {
    expect(sourceLogo('dark', true)).toBe('/ikanai-logo-horizontal.png');
    expect(sourceLogo('dark', false)).toBe('/ikanai-mark.png');
  });

  it('la connexion affiche le logo horizontal officiel', () => {
    expect(sourceConnexion).toContain('src="/ikanai-logo-horizontal.png"');
  });

  it('plus aucune variante à texte vert ou citron, nulle part dans le dashboard', () => {
    for (const [chemin, texte] of Object.entries(SOURCES)) {
      expect(texte, chemin).not.toMatch(/ikanai-logo-horizontal-(green|lime)/);
    }
    expect(Object.values(SOURCES_LOGO)).toHaveLength(4);
  });
});

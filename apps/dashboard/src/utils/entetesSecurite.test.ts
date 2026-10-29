import { describe, expect, it } from 'vitest';
import { enTetesSecurite, estProduction, politiqueCsp } from '../../entetes-securite.mjs';

const NOMS_FIXES = ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy-Report-Only'];

describe('en-têtes de sécurité du dashboard (fonction pure)', () => {
  it('pose tous les en-têtes, HSTS seulement en production (6 mois, sans includeSubDomains ni preload)', () => {
    const hors = enTetesSecurite({ production: false });
    for (const nom of NOMS_FIXES) expect(hors[nom], nom).toBeTruthy();
    expect(hors).not.toHaveProperty('Strict-Transport-Security');
    expect(enTetesSecurite()).not.toHaveProperty('Strict-Transport-Security');
    const prod = enTetesSecurite({ production: true });
    expect(prod['Strict-Transport-Security']).toBe('max-age=15552000');
    expect(prod['X-Frame-Options']).toBe('DENY');
    expect(prod['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(prod['X-Content-Type-Options']).toBe('nosniff');
  });

  it('permissions : caméra et micro fermés, géolocalisation pour le site seul (sélecteur de position)', () => {
    const pp = enTetesSecurite()['Permissions-Policy'];
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=(self)');
  });

  it('la CSP est en Report-Only seulement et liste les sources réellement utilisées', () => {
    const h = enTetesSecurite({ production: true, apiUrl: 'https://api.exemple.io/api/v1', agentUrl: 'https://yam.exemple.io' });
    expect(h).not.toHaveProperty('Content-Security-Policy');
    const csp = h['Content-Security-Policy-Report-Only'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).toMatch(/connect-src 'self' https:\/\/api\.exemple\.io https:\/\/yam\.exemple\.io https:\/\/nominatim\.openstreetmap\.org/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(politiqueCsp('pas une url')).not.toMatch(/undefined|null/);
  });

  it('production = APP_ENV=production, ou NODE_ENV=production si APP_ENV est absent', () => {
    expect(estProduction({ APP_ENV: 'production' })).toBe(true);
    expect(estProduction({ NODE_ENV: 'production' })).toBe(true);
    expect(estProduction({ APP_ENV: 'development', NODE_ENV: 'production' })).toBe(false);
    expect(estProduction({})).toBe(false);
  });
});

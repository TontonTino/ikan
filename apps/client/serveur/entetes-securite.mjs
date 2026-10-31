/**
 * En-têtes de sécurité pour les réponses qui ne passent PAS par le middleware Astro (fichiers statiques : JS, CSS, polices,
 * images). Le middleware (src/middleware.ts + src/utils/securite.ts) les pose déjà sur les pages ; ce fichier reproduit
 * EXACTEMENT la même liste en JavaScript pur, car le serveur de production (Node 20) ne peut pas importer du TypeScript.
 * Un test (src/utils/serveur-entetes.test.mjs) vérifie que les deux restent identiques.
 */

export const API_URL_PAR_DEFAUT = 'https://ikan-772d.onrender.com/api/v1';

export function origineApi(apiUrl) {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return null;
  }
}

export function politiqueCsp(apiUrl) {
  const api = origineApi(apiUrl);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${api ? ` ${api}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function enTetesSecurite(apiUrl, production = true) {
  const hsts = production ? { 'Strict-Transport-Security': 'max-age=15552000' } : {};
  return {
    ...hsts,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Content-Security-Policy-Report-Only': politiqueCsp(apiUrl),
  };
}

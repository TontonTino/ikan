/**
 * En-têtes de sécurité du serveur du dashboard (server.mjs), posés sur TOUTES les réponses (pages, fichiers, 404, 405, 500).
 * Logique pure, testée par `npm test` (src/utils/entetesSecurite.test.ts).
 *
 * La CSP est en mode REPORT-ONLY : elle ne bloque rien, le navigateur signale seulement les violations dans sa console
 * (onglet Console des outils de développement, messages « [Report Only] Refused to … »).
 */

const API_PAR_DEFAUT = 'https://ikan-772d.onrender.com/api/v1';
const AGENT_PAR_DEFAUT = 'https://yam-tpip.onrender.com';

/** Origine (schéma + hôte) d'une URL, ou null si elle est invalide. */
export function origine(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Sources réellement utilisées par le dashboard :
 *  - scripts : les fichiers du site seulement (Vite ne génère aucun script en ligne) ;
 *  - styles : 'unsafe-inline' (attributs style de React, <style> de index.html) + feuille Google Fonts (global.css) ;
 *  - polices : fichiers Google Fonts (gstatic) ;
 *  - images : site, data: (logos, motifs), blob:, et https: car le logo d'une organisation peut être une URL libre ; tuiles OpenStreetMap ;
 *  - connexions : API, agent YAM, recherche d'adresse Nominatim (sélecteur de position d'agence) ;
 *  - workers : blob: (génération PDF).
 */
export function politiqueCsp(apiUrl, agentUrl) {
  const api = origine(apiUrl || API_PAR_DEFAUT);
  const agent = origine(agentUrl || AGENT_PAR_DEFAUT);
  const connexions = ["'self'", api, agent, 'https://nominatim.openstreetmap.org'].filter(Boolean);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src ${connexions.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** HSTS (6 mois, sans includeSubDomains ni preload) uniquement si `production` est vrai. */
export function enTetesSecurite({ production = false, apiUrl, agentUrl } = {}) {
  const entetes = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Le sélecteur de position d'une agence utilise la géolocalisation du navigateur, pour le site lui-même seulement.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
    'Content-Security-Policy-Report-Only': politiqueCsp(apiUrl, agentUrl),
  };
  if (production) entetes['Strict-Transport-Security'] = 'max-age=15552000';
  return entetes;
}

/** Production : APP_ENV=production ou NODE_ENV=production (valeur par défaut des services Node de Render). */
export function estProduction(env) {
  return env.APP_ENV === 'production' || (env.APP_ENV === undefined && env.NODE_ENV === 'production');
}

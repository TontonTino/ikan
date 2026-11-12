/**
 * Adresse de l'API : TOUJOURS depuis PUBLIC_API_URL, jamais codée en dur.
 *
 *  - en développement : repli sur l'API locale (http://localhost:8000/api/v1) ;
 *  - en production : le build (astro.config.mjs) et le serveur (serveur.mjs) s'arrêtent avec un message qui nomme la
 *    variable, plutôt que d'envoyer les avis des clients vers une ancienne adresse.
 *
 * JavaScript pur : importé par serveur.mjs (Node 20, sans TypeScript) comme par le middleware et la page Astro.
 * Testé par `npm test` (src/utils/adresse-api.test.mjs).
 */

export const API_URL_DEV = 'http://localhost:8000/api/v1';

export const MESSAGE_API_MANQUANTE =
  "[IKAN AI] PUBLIC_API_URL est manquante : en production, le formulaire client ne sait pas où envoyer les avis. " +
  "Renseignez-la dans l'environnement du service (Render, AWS…) ou dans apps/client/.env.production. Voir apps/client/.env.example.";

/** Adresse configurée (espaces retirés) ; repli local en développement ; erreur explicite en production. */
export function adresseApi(valeur, production) {
  const adresse = String(valeur ?? '').trim();
  if (adresse) return adresse;
  if (production) throw new Error(MESSAGE_API_MANQUANTE);
  return API_URL_DEV;
}

/**
 * Adresses des services (API, formulaire client, agent YAM) : elles viennent TOUJOURS de l'environnement.
 * Aucune adresse de déploiement n'est codée dans le dashboard.
 *
 *  - en développement : repli sur localhost (voir src/config.ts et src/services/api.ts) ;
 *  - en production : le build (vite.config.ts) et le serveur (server.mjs) s'arrêtent avec un message qui nomme
 *    chaque variable manquante, plutôt que de partir silencieusement vers une ancienne adresse.
 *
 * Logique pure, testée par `npm test` (src/utils/variablesRequises.test.ts).
 */

/** Lues par le code du navigateur : nécessaires au build de production. */
export const VARIABLES_BUILD = ['VITE_API_URL', 'VITE_CLIENT_URL', 'VITE_AGENT_URL'];

/** Lues par server.mjs pour la politique de sécurité (connect-src) : nécessaires au démarrage en production. */
export const VARIABLES_SERVEUR = ['VITE_API_URL', 'VITE_AGENT_URL'];

/** Noms des variables absentes ou vides. */
export function variablesManquantes(env, noms) {
  return noms.filter((nom) => !String(env[nom] ?? '').trim());
}

/** Message d'arrêt, qui nomme chaque variable manquante et dit où la renseigner. */
export function messageVariablesManquantes(manquantes, etape) {
  const liste = manquantes.join(', ');
  const pluriel = manquantes.length > 1;
  return (
    `[IKAN AI] ${etape} impossible : ${pluriel ? 'variables manquantes' : 'variable manquante'} ${liste}. ` +
    `Renseignez-${pluriel ? 'les' : 'la'} dans l'environnement du service (Render, AWS…) ` +
    `ou dans apps/dashboard/.env.production. Voir apps/dashboard/.env.example.`
  );
}

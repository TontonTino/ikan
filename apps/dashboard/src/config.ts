// Adresses des services : TOUJOURS depuis l'environnement (VITE_CLIENT_URL, VITE_AGENT_URL).
// En développement seulement, repli sur localhost. En production, le build s'arrête si une variable
// manque (voir variables-requises.mjs et vite.config.ts) : aucun repli silencieux sur une ancienne adresse.
const DEV = import.meta.env.DEV;

// URL de base de l'application client (formulaire de feedback public scanné via QR code).
export const CLIENT_URL = import.meta.env.VITE_CLIENT_URL || (DEV ? 'http://localhost:4321' : '');

export function getFeedbackUrl(codeOrToken: string): string {
  return `${CLIENT_URL}/feedback/${codeOrToken}`;
}

// URL de base de l'agent IA YAM (service séparé, sans slash final).
export const AGENT_URL = (import.meta.env.VITE_AGENT_URL || (DEV ? 'http://localhost:8001' : '')).replace(/\/+$/, '');

// Présence de YAM dans le dashboard (bande de synthèse, mascotte du panneau, notes d'honnêteté, état vide de la page Actions).
// Active par défaut ; VITE_YAM_PRESENCE=non retire toutes ces interventions (retour arrière sans toucher au code).
export const YAM_PRESENCE = import.meta.env.VITE_YAM_PRESENCE !== 'non';

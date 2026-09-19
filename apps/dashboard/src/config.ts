// URL de base de l'application client (formulaire de feedback public scanné via QR code).
export const CLIENT_URL = import.meta.env.VITE_CLIENT_URL || 'https://ikan-1.onrender.com';

export function getFeedbackUrl(codeOrToken: string): string {
  return `${CLIENT_URL}/feedback/${codeOrToken}`;
}

// URL de base de l'agent IA YAM (service séparé, sans slash final). En local : VITE_AGENT_URL=http://localhost:8001
export const AGENT_URL = (import.meta.env.VITE_AGENT_URL || 'https://yam-tpip.onrender.com').replace(/\/+$/, '');

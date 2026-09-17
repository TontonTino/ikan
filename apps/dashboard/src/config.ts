// URL de base de l'application client (formulaire de feedback public scanné via QR code).
export const CLIENT_URL = import.meta.env.VITE_CLIENT_URL || 'https://ikan-1.onrender.com';

export function getFeedbackUrl(codeOrToken: string): string {
  return `${CLIENT_URL}/feedback/${codeOrToken}`;
}

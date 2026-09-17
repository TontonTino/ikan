/**
 * useAuth -- wrapper sur useAuthStore + lecture du cookie access_token.
 * Le cookie access_token est accessible en JS en mode development (samesite=lax,
 * non HttpOnly). En production (HTTPS), il passe en HttpOnly -> le Bearer sera null
 * mais le cookie sera envoye automatiquement via credentials:'include'.
 */
import { useAuthStore } from '../stores/authStore';

function getCookieToken(): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith('access_token='));
  return match ? match.split('=')[1] : null;
}

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const token = getCookieToken();
  return { user, token };
}
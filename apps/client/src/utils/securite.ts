/**
 * En-têtes de sécurité de toutes les réponses du client (posés par src/middleware.ts) et adresse IP du visiteur
 * transmise à l'API pour sa limitation de débit. Logique pure, testée par `npm test`.
 */

/** Origine (schéma + hôte) d'une URL d'API, ou null si l'URL est invalide. */
export function origineApi(apiUrl: string): string | null {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return null;
  }
}

/**
 * CSP en mode REPORT-ONLY : elle ne bloque rien, le navigateur signale seulement les violations dans sa console.
 * 'unsafe-inline' reste nécessaire tant que le formulaire contient des <style> et <script> en ligne (Astro) : à
 * remplacer par des nonces avant de passer la politique en mode bloquant.
 */
export function politiqueCsp(apiUrl: string): string {
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

export function enTetesSecurite(apiUrl: string): Record<string, string> {
  return {
    // HSTS : ignoré par les navigateurs en HTTP simple, appliqué dès que le site est servi en HTTPS.
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // Le code du QR figure dans le chemin de la page : il ne doit pas fuiter vers un autre site.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // La dictée vocale du commentaire a besoin du micro, uniquement pour le site lui-même.
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Content-Security-Policy-Report-Only': politiqueCsp(apiUrl),
  };
}

/**
 * Adresse du visiteur à transmettre à l'API. X-Forwarded-For n'est lu que si `sauts` > 0 (nombre de proxys de
 * confiance devant ce serveur) et on retient l'entrée posée par NOTRE proxy (la `sauts`-ième depuis la droite),
 * jamais une valeur fournie par le visiteur ; sinon l'adresse du socket.
 */
export function ipVisiteur(forwardedFor: string | null | undefined, adresseSocket: string | null | undefined, sauts: number): string | null {
  if (sauts > 0 && forwardedFor) {
    const morceaux = forwardedFor.split(',').map((m) => m.trim()).filter(Boolean);
    if (morceaux.length >= sauts) return morceaux[morceaux.length - sauts];
  }
  return adresseSocket || null;
}

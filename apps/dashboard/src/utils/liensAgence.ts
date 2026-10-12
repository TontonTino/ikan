import type { UserRole } from '../types';

/** Aperçu d'une agence (CX Manager) : identifiant dans le chemin, onglet dans la requête. */
export type OngletApercu = 'feedbacks' | 'suggestions' | 'rappels' | 'activite' | 'categories';

export function lienApercuAgence(agenceId: string, onglet?: OngletApercu): string {
  const base = `/agences/${encodeURIComponent(agenceId)}/apercu`;
  return onglet ? `${base}?tab=${onglet}` : base;
}

/** Contexte conservé dans le lien : l'avis ciblé, le thème et la période (en jours) du tableau de bord d'origine. */
export interface ContexteAvis {
  avisId?: string | null;
  theme?: string | null;
  jours?: number | null;
}

function requete(parametres: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) if (valeur) q.set(cle, valeur);
  const texte = q.toString();
  return texte ? `?${texte}` : '';
}

/**
 * Lien vers les avis d'une agence connue.
 *  - CX Manager : l'avis se retrouve dans l'aperçu de SON agence (le contexte d'agence est conservé) ;
 *  - Responsable d'agence : sa liste d'avis (déjà limitée à son agence), avec l'onglet demandé ;
 *  - agence inconnue : liste d'avis du périmètre du rôle, sans inventer de contexte.
 * `contexte` transmet l'avis ciblé, le thème et la période ; la page de destination les applique et n'en
 * retient que les valeurs valides. Le lien n'est jamais une autorisation : le serveur filtre quoi qu'il arrive.
 */
export function lienAvis(role: UserRole | undefined, agenceId?: string | null, ongletAvis?: string, contexte: ContexteAvis = {}): string {
  const ctx = { avis: contexte.avisId, theme: contexte.theme, jours: contexte.jours ? String(contexte.jours) : null };
  if (role === 'cx_manager' && agenceId) return `/agences/${encodeURIComponent(agenceId)}/apercu${requete({ tab: 'feedbacks', ...ctx })}`;
  return `/feedbacks${requete({ tab: ongletAvis, ...ctx })}`;
}

/** Liste réseau des avis (CX Manager), éventuellement limitée à une agence et à une période. */
export function lienAvisReseau(contexte: ContexteAvis & { agenceId?: string | null; onglet?: string } = {}): string {
  return `/feedbacks${requete({ tab: contexte.onglet, agence: contexte.agenceId, theme: contexte.theme, jours: contexte.jours ? String(contexte.jours) : null })}`;
}

/**
 * Démonstration publique (demo.ikanai.bf) — docs/demo-publique.md.
 *
 * Deux verrous : le build de démo pose VITE_DEMO_MODE=oui, ET l'API de démo confirme les rôles proposés (GET /auth/demo).
 * Sans le premier, aucune requête n'est faite : le dashboard de production n'interroge jamais cette route.
 */
import { useEffect, useState } from 'react';
import { authApi } from './api';

export type RoleDemo = 'cx_manager' | 'agency_manager';

export const BUILD_DEMO = import.meta.env.VITE_DEMO_MODE === 'oui';

/** Ordre d'affichage et libellés des boutons d'entrée. */
export const ENTREES_DEMO: Record<RoleDemo, { titre: string; detail: string }> = {
  cx_manager: {
    titre: 'Responsable expérience client',
    detail: 'Tout le réseau, les alertes et YAM.',
  },
  agency_manager: {
    titre: 'Responsable d’agence',
    detail: 'Une agence, ses avis et ses actions.',
  },
};

export const MENTION_DEMO = 'Démonstration — données fictives, remises à zéro chaque nuit.';

/** Garde, dans l'ordre d'affichage, les seuls rôles connus que l'API propose. */
export function rolesProposes(roles: unknown): RoleDemo[] {
  const recus = Array.isArray(roles) ? roles : [];
  return (Object.keys(ENTREES_DEMO) as RoleDemo[]).filter((role) => recus.includes(role));
}

let demande: Promise<RoleDemo[]> | null = null;

export function chargerRolesDemo(): Promise<RoleDemo[]> {
  if (!BUILD_DEMO) return Promise.resolve([]);
  demande ??= authApi
    .demo()
    .then((res) => rolesProposes(res.data?.roles))
    .catch(() => {
      demande = null; // API momentanément injoignable : on réessaiera au prochain affichage
      return [];
    });
  return demande;
}

/** Rôles proposés à l'entrée de la démonstration ; liste vide hors démo. */
export function useRolesDemo(): RoleDemo[] {
  const [roles, setRoles] = useState<RoleDemo[]>([]);
  useEffect(() => {
    let actif = true;
    chargerRolesDemo().then((r) => actif && setRoles(r));
    return () => {
      actif = false;
    };
  }, []);
  return roles;
}

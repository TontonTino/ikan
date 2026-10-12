import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ROUTE_ROLES, redirectionRole } from './navigation';

/**
 * Garde de route par rôle, alimentée par ROUTE_ROLES (navigation.tsx).
 * Un rôle non autorisé est renvoyé vers son propre accueil.
 * Garde d'interface uniquement : l'isolation des données reste assurée par l'API.
 */
export default function RoleRoute({ pattern, children }: { pattern: keyof typeof ROUTE_ROLES; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  const destination = redirectionRole(user.role, pattern);
  if (destination) return <Navigate to={destination} replace />;
  return <>{children}</>;
}

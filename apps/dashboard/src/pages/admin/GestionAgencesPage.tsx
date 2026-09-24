import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import AdminAgencesContent from './AdminAgencesContent';
import AdminUsersContent from './AdminUsersContent';

/**
 * Page "Gestion des agences".
 * - CX Manager : Répertoire des agences unique (agences + chefs d'agence sur chaque carte). Il n'y a
 *   plus d'onglets : un ancien lien `?tab=utilisateurs` retombe simplement sur cette liste.
 * - Admin : gestion des CX Managers (structure inchangée). L'Admin ne gère pas les agences directement.
 */
export default function GestionAgencesPage() {
  const currentUser = useAuthStore((s) => s.user);

  if (currentUser?.role === 'agency_manager') {
    return <Navigate to="/agence" replace />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {currentUser?.role === 'cx_manager' ? <AdminAgencesContent /> : <AdminUsersContent />}
    </div>
  );
}

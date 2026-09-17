import React from 'react';
import { useAuthStore } from '../../stores/authStore';
import StatsCXView from './StatsCXView';
import StatsAgencyView from './StatsAgencyView';
import StatsAdminView from './StatsAdminView';

export default function StatistiquesPage() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'admin') {
    return <StatsAdminView />;
  }

  if (user?.role === 'agency_manager') {
    return <StatsAgencyView />;
  }

  // CX Manager (ou par défaut)
  return <StatsCXView />;
}

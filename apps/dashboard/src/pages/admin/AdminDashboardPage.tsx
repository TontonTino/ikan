import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { dashboardApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import AdminWelcomeBanner from '../../components/admin/AdminWelcomeBanner';
import AdminStructureKpis from '../../components/admin/AdminStructureKpis';
import RepartitionForfaitsCard from '../../components/admin/RepartitionForfaitsCard';
import AdminOrganisationsTable from '../../components/admin/AdminOrganisationsTable';
import type { DashboardAdminStats } from '../../types';

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  if (user?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }

  const [stats, setStats] = useState<DashboardAdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = () => {
    setRefreshing(true);
    dashboardApi
      .admin()
      .then((res) => {
        if (res.data) {
          setStats(res.data);
        }
      })
      .catch((err) => {
        console.error('Erreur chargement dashboard admin:', err);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    loadData();
  }, []);

  const prenom = user?.prenom || 'Système';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* ── 1. Bannière ── */}
      <AdminWelcomeBanner
        userName={prenom}
        subtitle="Voici un aperçu structurel de vos organisations, agences et comptes sur la plateforme IKAN AI."
      />

      {/* ── 2. Compteurs structurels + répartition par forfait ── */}
      <AdminStructureKpis
        totalOrganisations={stats?.total_organisations ?? 0}
        totalAgences={stats?.total_agences ?? 0}
        totalCXManagers={stats?.total_cx_managers ?? 0}
        totalAgencyManagers={stats?.total_agency_managers ?? 0}
        totalUtilisateursActifs={stats?.total_utilisateurs_actifs ?? 0}
      />
      <RepartitionForfaitsCard repartition={stats?.repartition_forfaits ?? []} />

      {/* ── 3. Tableau Organisations en PLEINE LARGEUR (100%) ── */}
      <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <AdminOrganisationsTable
          organisations={stats?.organisations_overview ?? []}
          loading={loading || refreshing}
        />
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { dashboardApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import AdminWelcomeBanner from '../../components/admin/AdminWelcomeBanner';
import AdminEvolutionChart from '../../components/admin/AdminEvolutionChart';
import AdminOrganisationsTable from '../../components/admin/AdminOrganisationsTable';
import AdminKpiSidebar from '../../components/admin/AdminKpiSidebar';
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
      {/* ── 1. Section Supérieure : Banner & Graphique à gauche, KPIs à droite ── */}
      <div
        className="admin-dashboard-top-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: '20px',
          alignItems: 'start',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        {/* Colonne Gauche : Welcome Banner + Graphique */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <AdminWelcomeBanner
            userName={prenom}
            subtitle="Voici un aperçu de vos organisations et CX Managers sur la plateforme IKAN AI."
          />

          <AdminEvolutionChart
            activity7d={stats?.activity_7d}
            activity30d={stats?.activity_30d}
            activity90d={stats?.activity_90d}
            totalFeedbacks={stats?.total_feedbacks ?? 0}
            processedFeedbacks={stats?.processed_feedbacks ?? 0}
            satisfactionRate={stats?.satisfaction_globale ?? '0%'}
          />
        </div>

        {/* Colonne Droite : Colonne Verticale des 6 KPIs Statistiques */}
        <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <AdminKpiSidebar
            totalOrganisations={stats?.total_organisations ?? 0}
            organisationsTrend={stats?.organisations_trend}
            organisationsTrendPositive={stats?.organisations_trend_positive ?? true}
            totalCXManagers={stats?.total_cx_managers ?? 0}
            cxManagersTrend={stats?.cx_managers_trend}
            cxManagersTrendPositive={stats?.cx_managers_trend_positive ?? true}
            satisfactionGlobale={stats?.satisfaction_globale ?? '0%'}
            satisfactionTrend={stats?.satisfaction_trend}
            satisfactionTrendPositive={stats?.satisfaction_trend_positive ?? true}
            totalFeedbacks={stats?.total_feedbacks ?? 0}
            feedbacksTrend={stats?.feedbacks_trend}
            feedbacksTrendPositive={stats?.feedbacks_trend_positive ?? true}
            processedFeedbacks={stats?.processed_feedbacks ?? 0}
            processedTrend={stats?.processed_trend}
            processedTrendPositive={stats?.processed_trend_positive ?? true}
            totalAlertes={stats?.total_alertes ?? 0}
            alertesTrend={stats?.alertes_trend}
            alertesTrendPositive={stats?.alertes_trend_positive ?? false}
          />
        </div>
      </div>

      {/* ── 2. Section Inférieure : Tableau Organisations en PLEINE LARGEUR (100%) ── */}
      <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <AdminOrganisationsTable
          organisations={stats?.organisations_overview ?? []}
          loading={loading || refreshing}
        />
      </div>

      {/* Style Responsive pour la Grille Supérieure */}
      <style>{`
        @media (max-width: 1180px) {
          .admin-dashboard-top-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

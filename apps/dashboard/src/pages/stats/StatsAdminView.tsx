import React, { useEffect, useState, useCallback } from 'react';
import { statisticsApi } from '../../services/api';
import type { StatsAdminResponse } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import KpiCard from '../../components/ui/KpiCard';
import TabsNavigation from '../../components/ui/TabsNavigation';
import RepartitionForfaitsCard from '../../components/admin/RepartitionForfaitsCard';
import OrganisationsStatsTable from '../../components/stats/OrganisationsStatsTable';
import {
  StatsLoadingState,
  StatsErrorState,
  StatsSectionCard,
} from '../../components/stats/StatsStates';
import { BuildingIcon, StoreIcon, UsersIcon, TrendingUpIcon } from '../../components/common/Icons';

export default function StatsAdminView() {
  const [activeTab, setActiveTab] = useState<'overview' | 'organisations'>('overview');
  const [data, setData] = useState<StatsAdminResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await statisticsApi.admin();
      setData(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors du chargement des statistiques de la plateforme.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ikanai_structure_plateforme.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const kpis = data?.kpis || {};

  const tabsConfig = [
    { id: 'overview', label: "Vue d'ensemble", icon: <TrendingUpIcon size={16} /> },
    { id: 'organisations', label: 'Organisations', icon: <BuildingIcon size={16} />, badge: data?.organisations.length },
  ];

  return (
    <div style={{ padding: '0 36px 48px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      <PageHeader
        title="Statistiques de la plateforme"
        subtitle="Vue structurelle : organisations, agences, comptes et forfaits"
        onRefresh={fetchData}
        onExport={handleExport}
      />

      <TabsNavigation tabs={tabsConfig} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />

      {loading && !data && <StatsLoadingState message="Chargement de la structure de la plateforme..." />}
      {error && !loading && <StatsErrorState message={error} onRetry={fetchData} />}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {activeTab === 'overview' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <KpiCard icon={<BuildingIcon size={20} />} label="Organisations actives" value={kpis.organisations_actives?.valeur ?? 0} compact subtitle={kpis.organisations_actives?.sous_titre || undefined} />
                <KpiCard icon={<StoreIcon size={20} />} label="Total Agences" value={kpis.total_agences?.valeur ?? 0} compact subtitle={kpis.total_agences?.sous_titre || undefined} />
                <KpiCard icon={<UsersIcon size={20} />} label="Utilisateurs actifs" value={kpis.utilisateurs_actifs?.valeur ?? 0} compact subtitle={kpis.utilisateurs_actifs?.sous_titre || undefined} />
                <KpiCard icon={<UsersIcon size={20} />} label="CX Managers" value={kpis.cx_managers?.valeur ?? 0} compact subtitle={kpis.cx_managers?.sous_titre || undefined} />
                <KpiCard icon={<UsersIcon size={20} />} label="Agency Managers" value={kpis.agency_managers?.valeur ?? 0} compact subtitle={kpis.agency_managers?.sous_titre || undefined} />
              </div>
              <RepartitionForfaitsCard repartition={data.repartition_forfaits} />
            </>
          )}

          {activeTab === 'organisations' && (
            <StatsSectionCard
              title="Organisations déployées"
              subtitle="Structure et forfait de chaque entreprise (aucune donnée client)"
            >
              <OrganisationsStatsTable organisations={data.organisations} />
            </StatsSectionCard>
          )}
        </div>
      )}
    </div>
  );
}

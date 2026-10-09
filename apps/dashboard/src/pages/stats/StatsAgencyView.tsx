import React, { useEffect, useState, useCallback } from 'react';
import { statisticsApi } from '../../services/api';
import type { StatsAgenceResponse } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import KpiCard from '../../components/ui/KpiCard';
import TabsNavigation from '../../components/ui/TabsNavigation';
import PeriodSelector from '../../components/stats/PeriodSelector';
import SatisfactionEvolutionChart from '../../components/stats/SatisfactionEvolutionChart';
import VolumeEvolutionChart from '../../components/stats/VolumeEvolutionChart';
import SentimentDonutChart from '../../components/stats/SentimentDonutChart';
import ThemesBarList from '../../components/stats/ThemesBarList';
import AlertesSyntheseCard from '../../components/stats/AlertesSyntheseCard';
import AiInsightsSummary from '../../components/stats/AiInsightsSummary';
import {
  StatsLoadingState,
  StatsErrorState,
  StatsSectionCard,
} from '../../components/stats/StatsStates';
import {
  SmileIcon,
  MessageSquareIcon,
  TrendingUpIcon,
  TagIcon,
} from '../../components/common/Icons';

export default function StatsAgencyView() {
  const [activeTab, setActiveTab] = useState<'satisfaction' | 'sentiments_themes' | 'alertes'>('satisfaction');
  const [jours, setJours] = useState<number>(30);
  const [data, setData] = useState<StatsAgenceResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await statisticsApi.agency({ jours });
      setData(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Impossible de charger les statistiques de l’agence.");
    } finally {
      setLoading(false);
    }
  }, [jours]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = () => {
    if (!data) return;
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ikanai_statistiques_agence_${data.agence_nom.replace(/\s+/g, '_')}_${jours}j.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const kpis = data?.kpis || {};

  const tabsConfig = [
    { id: 'satisfaction', label: 'Satisfaction et volume', icon: <SmileIcon size={16} /> },
    { id: 'sentiments_themes', label: 'Ton des avis et thèmes', icon: <TagIcon size={16} /> },
    {
      id: 'alertes',
      label: 'Avis critiques et analyse',
      badge: data?.alertes_synthese.total_critiques,
      badgeColor: (data?.alertes_synthese.total_critiques || 0) > 0 ? ('red' as const) : ('default' as const),
    },
  ];

  return (
    <div
      style={{
        padding: '0 36px 48px',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <PageHeader
        title="Statistiques"
        subtitle={`Agence ${data?.agence_nom || ''} (${data?.periode_label || '30 derniers jours'})`}
        onRefresh={fetchData}
        onExport={handleExport}
      >
        <PeriodSelector value={jours} onChange={setJours} />
      </PageHeader>

      {/* Bandeau permanent : 3 KPI avec variation vs période précédente, visibles quel que soit l'onglet actif */}
      {data && (
        <div
          data-testid="stats-agency-kpi-band"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          <KpiCard
            icon={<SmileIcon size={20} />}
            label="Satisfaction"
            hint="Part des avis notés 4 ou 5 sur 5 sur la période."
            value={kpis.satisfaction?.valeur ?? "Pas d'avis"}
            trend={
              kpis.satisfaction?.evolution
                ? {
                    value: kpis.satisfaction.evolution,
                    isPositive: kpis.satisfaction.is_positive,
                    period: 'vs période précédente',
                  }
                : undefined
            }
            sparklineType={kpis.satisfaction?.is_positive ? 'up' : 'down'}
            badgeColor={kpis.satisfaction?.status === 'no_data' ? 'neutral' : kpis.satisfaction?.is_positive ? 'green' : 'red'}
            compact={true}
            highlight
          />

          <KpiCard
            icon={<MessageSquareIcon size={20} />}
            label="Avis reçus"
            value={kpis.total_feedbacks?.valeur ?? 0}
            trend={
              kpis.total_feedbacks?.evolution
                ? {
                    value: kpis.total_feedbacks.evolution,
                    isPositive: kpis.total_feedbacks.is_positive,
                    period: 'vs période précédente',
                  }
                : undefined
            }
            sparklineType="neutral"
            compact={true}
          />

          <KpiCard
            icon={<TrendingUpIcon size={20} />}
            label="Avis pris en charge"
            hint="Part des avis de la période ouverts par l’agence ou plus avancés (action en cours, résolus). Ne mesure pas la résolution."
            value={kpis.taux_traitement?.valeur ?? "Pas d'avis"}
            trend={
              kpis.taux_traitement?.evolution
                ? {
                    value: kpis.taux_traitement.evolution,
                    isPositive: kpis.taux_traitement.is_positive,
                    period: 'vs période précédente',
                  }
                : undefined
            }
            sparklineType="up"
            badgeColor="green"
            compact={true}
          />

        </div>
      )}

      {/* Tabs */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* États */}
      {loading && !data && <StatsLoadingState />}
      {error && !loading && <StatsErrorState message={error} onRetry={fetchData} />}

      {/* Contenu */}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* ── 1. SATISFACTION & FLUX ── */}
          {activeTab === 'satisfaction' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                title="Évolution de la satisfaction"
                subtitle="Part des avis notés 4 ou 5 sur 5, période par période"
              >
                <SatisfactionEvolutionChart data={data.evolution_satisfaction} height={260} />
              </StatsSectionCard>

              <StatsSectionCard
                title="Avis critiques ou négatifs : reçus et pris en charge"
                subtitle="Avis reçus comparés aux avis pris en charge par l’agence"
              >
                <VolumeEvolutionChart data={data.evolution_volume} height={260} showTreated={true} />
              </StatsSectionCard>
            </div>
          )}

          {/* ── 2. SENTIMENTS & THÉMATIQUES ── */}
          {activeTab === 'sentiments_themes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px' }}>
                <StatsSectionCard
                  title="Ton des avis"
                  subtitle="Ton détecté automatiquement à partir du commentaire (ou de la note si l’avis n’a pas de commentaire)"
                >
                  <SentimentDonutChart data={data.sentiments} height={240} />
                </StatsSectionCard>

                <StatsSectionCard
                  title="Thèmes les plus cités"
                  subtitle="Selon la catégorie choisie par le client dans le formulaire"
                >
                  <ThemesBarList themes={data.themes} maxItems={8} />
                </StatsSectionCard>
              </div>
            </div>
          )}

          {/* ── 3. ALERTES & CONSEILS IA ── */}
          {activeTab === 'alertes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
                <AlertesSyntheseCard alertes={data.alertes_synthese} />
                <AiInsightsSummary insights={data.insights_ia} />
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

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
  CheckCircleIcon,
  ClockIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
  ThumbsUpIcon,
  TagIcon,
  SparklesIcon,
} from '../../components/common/Icons';

export default function StatsAgencyView() {
  const [activeTab, setActiveTab] = useState<'overview' | 'satisfaction' | 'sentiments_themes' | 'alertes'>('overview');
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
      setError(err?.response?.data?.detail || "Erreur lors du chargement des statistiques de l'agence.");
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
    { id: 'overview', label: "Vue d'ensemble", icon: <TrendingUpIcon size={16} /> },
    { id: 'satisfaction', label: 'Satisfaction & Flux', icon: <SmileIcon size={16} /> },
    { id: 'sentiments_themes', label: 'Sentiments & Thématiques', icon: <TagIcon size={16} /> },
    {
      id: 'alertes',
      label: 'Alertes & Conseils IA',
      icon: <SparklesIcon size={16} color="#75B72A" />,
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
        title="Statistiques & Analyses"
        subtitle={`Analyse locale approfondie de l'agence ${data?.agence_nom || ''} (${data?.periode_label || '30 derniers jours'})`}
        onRefresh={fetchData}
        onExport={handleExport}
      >
        <PeriodSelector value={jours} onChange={setJours} />
      </PageHeader>

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
          
          {/* ── 1. VUE D'ENSEMBLE ── */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '16px',
                }}
              >
                <KpiCard
                  icon={<SmileIcon size={20} />}
                  label="Satisfaction locale"
                  value={kpis.satisfaction?.valeur ?? '0%'}
                  trend={
                    kpis.satisfaction?.evolution
                      ? {
                          value: kpis.satisfaction.evolution,
                          isPositive: kpis.satisfaction.is_positive,
                          period: 'vs. période préc.',
                        }
                      : undefined
                  }
                  sparklineType={kpis.satisfaction?.is_positive ? 'up' : 'down'}
                  badgeColor={kpis.satisfaction?.is_positive ? 'green' : 'red'}
                  compact={true}
                />

                <KpiCard
                  icon={<MessageSquareIcon size={20} />}
                  label="Feedbacks reçus"
                  value={kpis.total_feedbacks?.valeur ?? 0}
                  trend={
                    kpis.total_feedbacks?.evolution
                      ? {
                          value: kpis.total_feedbacks.evolution,
                          isPositive: kpis.total_feedbacks.is_positive,
                          period: 'vs. période préc.',
                        }
                      : undefined
                  }
                  sparklineType="neutral"
                  compact={true}
                />

                <KpiCard
                  icon={<TrendingUpIcon size={20} />}
                  label="Taux de traitement"
                  value={kpis.taux_traitement?.valeur ?? '0%'}
                  trend={
                    kpis.taux_traitement?.evolution
                      ? {
                          value: kpis.taux_traitement.evolution,
                          isPositive: kpis.taux_traitement.is_positive,
                          period: 'vs. période préc.',
                        }
                      : undefined
                  }
                  sparklineType="up"
                  badgeColor="green"
                  compact={true}
                />

                <KpiCard
                  icon={<AlertTriangleIcon size={20} />}
                  label="Alertes critiques"
                  value={kpis.alertes_critiques?.valeur ?? 0}
                  badgeColor={Number(kpis.alertes_critiques?.valeur_num || 0) > 0 ? 'red' : 'green'}
                  sparklineType={Number(kpis.alertes_critiques?.valeur_num || 0) > 0 ? 'down' : 'neutral'}
                  compact={true}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
                <StatsSectionCard
                  title="Évolution du Score de Satisfaction"
                  subtitle="Tendance calculée sur la période"
                >
                  <SatisfactionEvolutionChart data={data.evolution_satisfaction} height={230} />
                </StatsSectionCard>

                <StatsSectionCard
                  title="Sentiment des Clients de l'Agence"
                  subtitle="Répartition des avis positifs, neutres et négatifs"
                >
                  <SentimentDonutChart data={data.sentiments} height={230} />
                </StatsSectionCard>
              </div>
            </div>
          )}

          {/* ── 2. SATISFACTION & FLUX ── */}
          {activeTab === 'satisfaction' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                title="Évolution Détaillée de la Satisfaction Locale"
                subtitle="Courbe de suivi au fil des jours"
              >
                <SatisfactionEvolutionChart data={data.evolution_satisfaction} height={260} />
              </StatsSectionCard>

              <StatsSectionCard
                title="Volume d'Avis Reçus et Pris en Charge"
                subtitle="Activité quotidienne en agence"
              >
                <VolumeEvolutionChart data={data.evolution_volume} height={260} showTreated={true} />
              </StatsSectionCard>
            </div>
          )}

          {/* ── 3. SENTIMENTS & THÉMATIQUES ── */}
          {activeTab === 'sentiments_themes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px' }}>
                <StatsSectionCard
                  title="Climat Émotionnel de l'Agence"
                  subtitle="Proportion de retours favorables et axes d'amélioration"
                >
                  <SentimentDonutChart data={data.sentiments} height={240} />
                </StatsSectionCard>

                <StatsSectionCard
                  title="Principaux Thèmes Remontés"
                  subtitle="Points clés mentionnés par les clients de l'agence"
                >
                  <ThemesBarList themes={data.themes} maxItems={8} />
                </StatsSectionCard>
              </div>
            </div>
          )}

          {/* ── 4. ALERTES & CONSEILS IA ── */}
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

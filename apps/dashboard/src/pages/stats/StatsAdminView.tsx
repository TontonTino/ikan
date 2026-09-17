import React, { useEffect, useState, useCallback } from 'react';
import { statisticsApi } from '../../services/api';
import type { StatsAdminResponse } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import KpiCard from '../../components/ui/KpiCard';
import TabsNavigation from '../../components/ui/TabsNavigation';
import PeriodSelector, { PERIOD_OPTIONS } from '../../components/stats/PeriodSelector';
import VolumeEvolutionChart from '../../components/stats/VolumeEvolutionChart';
import OrganisationsStatsTable from '../../components/stats/OrganisationsStatsTable';
import {
  StatsLoadingState,
  StatsErrorState,
  StatsSectionCard,
} from '../../components/stats/StatsStates';
import {
  BuildingIcon,
  StoreIcon,
  MessageSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  TrendingUpIcon,
  SparklesIcon,
  UsersIcon,
  AlertTriangleIcon,
} from '../../components/common/Icons';

export default function StatsAdminView() {
  const [activeTab, setActiveTab] = useState<'overview' | 'volumes' | 'organisations' | 'ia_adoption'>('overview');
  const [jours, setJours] = useState<number>(30);
  const [data, setData] = useState<StatsAdminResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const adminPeriods = PERIOD_OPTIONS.filter((p) => p.jours >= 7);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await statisticsApi.admin({ jours });
      setData(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors du chargement des statistiques de la plateforme.');
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
    link.download = `ikanai_statistiques_plateforme_${jours}j.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const kpis = data?.kpis || {};
  const activite = data?.activite_plateforme || {};
  const iaUsage = data?.utilisation_ia || {};

  const tabsConfig = [
    { id: 'overview', label: "Vue d'ensemble", icon: <TrendingUpIcon size={16} /> },
    { id: 'volumes', label: 'Volumes & Traitement', icon: <MessageSquareIcon size={16} /> },
    { id: 'organisations', label: 'Organisations', icon: <BuildingIcon size={16} />, badge: data?.organisations_ranking.length },
    { id: 'ia_adoption', label: 'Moteur IA & Adoption', icon: <SparklesIcon size={16} color="#75B72A" /> },
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
        title="Statistiques de la plateforme"
        subtitle={`Suivi macroscopique de l'activité et de l'adoption d'IKAN AI (${data?.periode_label || '30 derniers jours'})`}
        onRefresh={fetchData}
        onExport={handleExport}
      >
        <PeriodSelector value={jours} onChange={setJours} options={adminPeriods} />
      </PageHeader>

      {/* Tabs */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* États */}
      {loading && !data && <StatsLoadingState message="Agrégation des indicateurs plateforme..." />}
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
                  icon={<BuildingIcon size={20} />}
                  label="Organisations actives"
                  value={kpis.organisations_actives?.valeur ?? 0}
                  compact={true}
                  subtitle={kpis.organisations_actives?.sous_titre || undefined}
                />

                <KpiCard
                  icon={<StoreIcon size={20} />}
                  label="Total Agences"
                  value={kpis.total_agences?.valeur ?? 0}
                  compact={true}
                  subtitle={kpis.total_agences?.sous_titre || undefined}
                />

                <KpiCard
                  icon={<MessageSquareIcon size={20} />}
                  label="Feedbacks collectés"
                  value={kpis.feedbacks_collectes?.valeur ?? 0}
                  trend={
                    kpis.feedbacks_collectes?.evolution
                      ? {
                          value: kpis.feedbacks_collectes.evolution,
                          isPositive: kpis.feedbacks_collectes.is_positive,
                          period: 'vs. période préc.',
                        }
                      : undefined
                  }
                  sparklineType="neutral"
                  compact={true}
                  subtitle={kpis.feedbacks_collectes?.sous_titre || undefined}
                />

                <KpiCard
                  icon={<TrendingUpIcon size={20} />}
                  label="Taux global traitement"
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
                  sparklineType={kpis.taux_traitement?.is_positive ? 'up' : 'down'}
                  badgeColor={kpis.taux_traitement?.is_positive ? 'green' : 'red'}
                  compact={true}
                  subtitle={kpis.taux_traitement?.sous_titre || undefined}
                />
              </div>

              <StatsSectionCard
                title="Flux Global des Retours Clients"
                subtitle="Évolution du volume collecté à l'échelle de la plateforme"
              >
                <VolumeEvolutionChart data={data.evolution_volume} height={240} showTreated={false} />
              </StatsSectionCard>
            </div>
          )}

          {/* ── 2. VOLUMES & TRAITEMENT ── */}
          {activeTab === 'volumes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
                  gap: '20px',
                }}
              >
                <StatsSectionCard
                  title="Évolution du Volume Global Collecté"
                  subtitle="Flux d'avis reçus sur l'ensemble des bornes"
                >
                  <VolumeEvolutionChart data={data.evolution_volume} height={260} showTreated={false} />
                </StatsSectionCard>

                <StatsSectionCard
                  title="Évolution du Traitement & Inférences IA"
                  subtitle="Collectés (vert clair) vs Analysés/Traités (vert foncé)"
                >
                  <VolumeEvolutionChart data={data.evolution_traitement} height={260} showTreated={true} />
                </StatsSectionCard>
              </div>
            </div>
          )}

          {/* ── 3. ORGANISATIONS & BENCHMARK ── */}
          {activeTab === 'organisations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                title="Performance Comparative des Entreprises Déployées"
                subtitle="Données macroscopiques agrégées (strictement 0 donnée personnelle ou textuelle)"
              >
                <OrganisationsStatsTable organisations={data.organisations_ranking} />
              </StatsSectionCard>
            </div>
          )}

          {/* ── 4. MOTEUR IA & ADOPTION ── */}
          {activeTab === 'ia_adoption' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
                  gap: '20px',
                }}
              >
                {/* Bloc Activité */}
                <div
                  style={{
                    background: '#FFFFFF',
                    borderRadius: '24px',
                    padding: '24px 28px',
                    border: '1px solid #E8ECE6',
                  }}
                >
                  <h3 style={{ fontSize: '1.02rem', fontWeight: 800, color: '#02302D', margin: '0 0 6px' }}>
                    Activité & Adoption Plateforme
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 18px' }}>
                    Indicateurs d'usage réels du système IKAN AI
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Organisations déployées</span>
                      <strong style={{ fontSize: '0.86rem', color: '#02302D' }}>{activite.organisations_actives ?? '—'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Agences et points de contact</span>
                      <strong style={{ fontSize: '0.86rem', color: '#02302D' }}>{activite.agences_actives ?? '—'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Gestionnaires et managers actifs</span>
                      <strong style={{ fontSize: '0.86rem', color: '#02302D' }}>{activite.utilisateurs_actifs ?? '—'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Boîte à idées — suggestions</span>
                      <strong style={{ fontSize: '0.86rem', color: '#02302D' }}>{activite.suggestions_soumises ?? '—'}</strong>
                    </div>
                  </div>
                </div>

                {/* Bloc Utilisation IA */}
                <div
                  style={{
                    background: 'linear-gradient(135deg, #F8FAF8 0%, #EFF7F0 100%)',
                    borderRadius: '24px',
                    padding: '24px 28px',
                    border: '1px solid #D6E8D9',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <SparklesIcon size={20} color="#75B72A" />
                    <h3 style={{ fontSize: '1.02rem', fontWeight: 800, color: '#02302D', margin: 0 }}>
                      Moteur d'IA & Inférence NLP
                    </h3>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 18px' }}>
                    Statistiques de traitement sémantique en temps réel
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2EFE1' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Modèle d'IA</span>
                      <strong style={{ fontSize: '0.84rem', color: '#02302D' }}>{iaUsage.moteur ?? 'IKAN AI Core'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2EFE1' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Analyses sur la période</span>
                      <strong style={{ fontSize: '0.86rem', color: '#3C7730' }}>{iaUsage.analyses_periode ?? 0}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2EFE1' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Taux de couverture NLP</span>
                      <strong style={{ fontSize: '0.86rem', color: '#02302D' }}>{iaUsage.taux_couverture_nlp ?? '100%'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2EFE1' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>Discordances détectées</span>
                      <strong style={{ fontSize: '0.86rem', color: '#D97706' }}>{iaUsage.discordances_signalees ?? 0}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { statisticsApi, agencesApi } from '../../services/api';
import type { StatsCXResponse, Agence } from '../../types';
import TabsNavigation from '../../components/ui/TabsNavigation';
import PeriodSelector from '../../components/stats/PeriodSelector';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import SatisfactionEvolutionChart from '../../components/stats/SatisfactionEvolutionChart';
import VolumeEvolutionChart from '../../components/stats/VolumeEvolutionChart';
import SentimentDonutChart from '../../components/stats/SentimentDonutChart';
import ThemesBarList from '../../components/stats/ThemesBarList';
import AgencesRankingTable from '../../components/stats/AgencesRankingTable';
import AlertesSyntheseCard from '../../components/stats/AlertesSyntheseCard';
import AiInsightsSummary from '../../components/stats/AiInsightsSummary';
import {
  StatsLoadingState,
  StatsErrorState,
  StatsEmptyState,
  StatsSectionCard,
} from '../../components/stats/StatsStates';
import {
  SmileIcon,
  MessageSquareIcon,
  ThumbsUpIcon,
  AlertTriangleIcon,
  BarChartIcon,
  TagIcon,
  StoreIcon,
} from '../../components/common/Icons';

export default function StatsCXView() {
  const [activeTab, setActiveTab] = useState<
    'satisfaction' | 'feedbacks' | 'sentiments' | 'thematiques' | 'agences' | 'tendances'
  >('satisfaction');

  const [jours, setJours] = useState<number>(30);
  const [selectedAgenceId, setSelectedAgenceId] = useState<string | null>(null);
  const [agencesList, setAgencesList] = useState<Agence[]>([]);
  const [data, setData] = useState<StatsCXResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Charger la liste des agences pour le filtre
  useEffect(() => {
    agencesApi
      .list()
      .then((res) => {
        if (Array.isArray(res.data)) {
          setAgencesList(res.data);
        }
      })
      .catch(() => setAgencesList([]));
  }, []);

  // Charger les données de statistiques
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await statisticsApi.cx({
        jours,
        agence_id: selectedAgenceId || undefined,
      });
      setData(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors du chargement des statistiques.');
    } finally {
      setLoading(false);
    }
  }, [jours, selectedAgenceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const kpis = data?.kpis || {};

  const tabsConfig = [
    { id: 'satisfaction', label: 'Satisfaction', icon: <SmileIcon size={16} /> },
    { id: 'feedbacks', label: 'Feedbacks', icon: <MessageSquareIcon size={16} /> },
    { id: 'sentiments', label: 'Sentiments', icon: <ThumbsUpIcon size={16} /> },
    { id: 'thematiques', label: 'Thématiques IA', icon: <TagIcon size={16} />, badge: data?.themes.length },
    { id: 'agences', label: 'Agences', icon: <StoreIcon size={16} />, badge: data?.agences_ranking.length },
    { id: 'tendances', label: 'Tendances & IA' },
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
      {/* ── Filtres Globaux (agence + période) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {/* Sélecteur d'Agence */}
        <AgenceFilterSelect
          agences={agencesList}
          selectedId={selectedAgenceId}
          onChange={setSelectedAgenceId}
        />

        {/* Sélecteur de Période */}
        <PeriodSelector value={jours} onChange={setJours} />
      </div>

      {/* ── Navigation par 6 Onglets Spécialisés ── */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* ── Gestion des États (Loading / Error) ── */}
      {loading && !data && <StatsLoadingState />}
      {error && !loading && <StatsErrorState message={error} onRetry={fetchData} />}

      {/* ── Contenu Organisé par Onglets ── */}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* ══════════════════════════════════════════════════════
              1. SATISFACTION (Analyse Approfondie du CSAT)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'satisfaction' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                title="Courbe Détaillée de Satisfaction Client"
                subtitle="Calcul dynamique au fil de l'eau avec variations et points d'inflexion"
              >
                <SatisfactionEvolutionChart data={data.evolution_satisfaction} height={280} />
              </StatsSectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              2. FEEDBACKS (Volumes, Flux & Traitement)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'feedbacks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                title="Flux des Avis : Collecte vs Traitement"
                subtitle="Comparatif quotidien entre flux d'avis entrants et volume pris en charge"
              >
                <VolumeEvolutionChart data={data.evolution_volume} height={280} showTreated={true} />
              </StatsSectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              3. SENTIMENTS (État Émotionnel & Polarités)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'sentiments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
                <StatsSectionCard
                  title="Répartition Émotionnelle des Avis"
                  subtitle="Classification automatique effectuée par le modèle sémantique"
                >
                  <SentimentDonutChart data={data.sentiments} height={260} />
                </StatsSectionCard>

                <div
                  style={{
                    background: '#FFFFFF',
                    borderRadius: '24px',
                    padding: '24px 28px',
                    border: '1px solid #E8ECE6',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
                      Indicateurs de Climat Client
                    </h3>
                    <p style={{ margin: '0 0 18px', fontSize: '0.78rem', color: '#64748B' }}>
                      Ratios de recommandation et niveau de détracteurs
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#EBF6ED', borderRadius: '12px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>Avis Promoteurs (Positifs)</span>
                        <strong style={{ fontSize: '0.92rem', color: '#3C7730' }}>
                          {kpis.feedbacks_positifs?.valeur ?? 0} avis
                        </strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#FEF3C7', borderRadius: '12px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>Avis Neutres</span>
                        <strong style={{ fontSize: '0.92rem', color: '#D97706' }}>
                          {data.sentiments.find((s) => s.sentiment.toLowerCase() === 'neutre')?.count || 0} avis
                        </strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#FEE2E2', borderRadius: '12px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>Avis Détracteurs (Négatifs)</span>
                        <strong style={{ fontSize: '0.92rem', color: '#DC2626' }}>
                          {kpis.feedbacks_negatifs?.valeur ?? 0} avis
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              4. THÉMATIQUES IA (15 Thèmes & NLP)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'thematiques' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                title="Cartographie des Thématiques Client Détectées"
                subtitle="Extraction sémantique automatique par le moteur IKAN NLP"
              >
                <ThemesBarList themes={data.themes} maxItems={15} />
              </StatsSectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              5. AGENCES (Classement & Benchmark Réseau)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'agences' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                title="Classement & Performance Comparative des Agences"
                subtitle="Benchmark consolidé par taux de satisfaction, volume traité et alertes"
              >
                <AgencesRankingTable
                  agences={data.agences_ranking}
                  selectedAgenceId={selectedAgenceId}
                  onSelectAgence={(id) => setSelectedAgenceId(id)}
                />
              </StatsSectionCard>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              6. TENDANCES (Évolutions, Anomalies & Insights IA)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'tendances' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
                  gap: '20px',
                }}
              >
                {/* Alertes Majeures */}
                <AlertesSyntheseCard
                  alertes={data.alertes_synthese}
                  onSelectAgence={(id) => {
                    setSelectedAgenceId(id);
                    setActiveTab('agences');
                  }}
                />

                {/* Synthèse IA & Recommandations */}
                <AiInsightsSummary insights={data.insights_ia} />
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

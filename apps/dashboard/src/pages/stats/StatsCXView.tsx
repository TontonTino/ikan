import React, { lazy, Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import type { AgenceCarte } from '../../components/map/AgencesMap';
import { statutSeuil, satisfactionTexte, STATUT_SEUIL_LABEL } from '../cx/siege/siegeData';

// Carte des agences (déplacée depuis le Dashboard CX) : chargée à la demande, Leaflet est lourd.
const AgencesMap = lazy(() => import('../../components/map/AgencesMap'));

type StatsTab = 'satisfaction' | 'feedbacks' | 'sentiments' | 'thematiques' | 'agences' | 'tendances';
const STATS_TABS: StatsTab[] = ['satisfaction', 'feedbacks', 'sentiments', 'thematiques', 'agences', 'tendances'];
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
  // Onglet piloté par l'URL (?tab=agences…) : le Dashboard CX peut pointer directement
  // sur Performance > Agences ou > Thématiques.
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as StatsTab | null;
  const activeTab: StatsTab = tabParam && STATS_TABS.includes(tabParam) ? tabParam : 'satisfaction';
  const setActiveTab = (tab: StatsTab) => setSearchParams(tab === 'satisfaction' ? {} : { tab }, { replace: true });

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
      setError(err?.response?.data?.detail || 'Impossible de charger les statistiques.');
    } finally {
      setLoading(false);
    }
  }, [jours, selectedAgenceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const kpis = data?.kpis || {};

  // Carte : coordonnées et seuil configuré viennent de /agences/, satisfaction et volume du classement.
  const agencesCarte = useMemo(() => {
    const meta = new Map(agencesList.map((a) => [a.id, a]));
    const avec: AgenceCarte[] = [];
    const sans: { id: string; nom: string; ville?: string | null; texte: string }[] = [];
    for (const r of data?.agences_ranking ?? []) {
      const m = meta.get(r.agence_id);
      const seuil = m?.seuil_alerte ?? null;
      const statut = statutSeuil(r.satisfaction_rate, r.total_feedbacks, seuil);
      if (m?.latitude != null && m?.longitude != null) {
        avec.push({ id: r.agence_id, nom: r.agence_nom, ville: r.ville, latitude: m.latitude, longitude: m.longitude, satisfaction: r.satisfaction_rate, avis: r.total_feedbacks, seuil, statut });
      } else {
        sans.push({ id: r.agence_id, nom: r.agence_nom, ville: r.ville, texte: `${satisfactionTexte(r.satisfaction_rate, r.total_feedbacks)} · ${STATUT_SEUIL_LABEL[statut]}` });
      }
    }
    return { avec, sans };
  }, [agencesList, data]);
  const voirAgence = (id: string) => navigate(`/agences/${id}/apercu`);

  const tabsConfig = [
    { id: 'satisfaction', label: 'Satisfaction', icon: <SmileIcon size={16} /> },
    { id: 'feedbacks', label: 'Avis clients', icon: <MessageSquareIcon size={16} /> },
    { id: 'sentiments', label: 'Ton des avis', icon: <ThumbsUpIcon size={16} /> },
    { id: 'thematiques', label: 'Thèmes', icon: <TagIcon size={16} />, badge: data?.themes.length },
    { id: 'agences', label: 'Agences', icon: <StoreIcon size={16} />, badge: data?.agences_ranking.length },
    { id: 'tendances', label: 'Ce que révèle l’analyse' },
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
        onChange={(id) => setActiveTab(id as StatsTab)}
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
                title="Évolution de la satisfaction"
                subtitle="Part des avis notés 4 ou 5 sur 5, période par période"
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
                title="Avis critiques ou négatifs : reçus et pris en charge"
                subtitle="Avis reçus comparés aux avis pris en charge par les agences"
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
                  title="Ton des avis"
                  subtitle="Ton détecté automatiquement à partir du commentaire (ou de la note si l’avis n’a pas de commentaire)"
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
                      Répartition des notes
                    </h3>
                    <p style={{ margin: '0 0 18px', fontSize: '0.78rem', color: '#64748B' }}>
                      Avis classés selon la note donnée par le client
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#EBF6ED', borderRadius: '12px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>Notés 4 ou 5 sur 5</span>
                        <strong style={{ fontSize: '0.92rem', color: '#3C7730' }}>
                          {kpis.feedbacks_positifs?.valeur ?? 0} avis
                        </strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#FEF3C7', borderRadius: '12px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>Notés 3 sur 5</span>
                        <strong style={{ fontSize: '0.92rem', color: '#D97706' }}>
                          {/* Même base que les deux autres lignes (la note), pas le ton détecté. */}
                          {Math.max(0, (kpis.total_feedbacks?.valeur_num ?? 0) - (kpis.feedbacks_positifs?.valeur_num ?? 0) - (kpis.feedbacks_negatifs?.valeur_num ?? 0))} avis
                        </strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#FEE2E2', borderRadius: '12px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>Notés 1 ou 2 sur 5</span>
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
                title="Thèmes les plus cités"
                subtitle="Selon la catégorie choisie par le client dans le formulaire"
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
                title="Classement des agences"
                subtitle="Comparaison par score fiabilisé, satisfaction, avis pris en charge et avis critiques"
              >
                <AgencesRankingTable
                  agences={data.agences_ranking}
                  selectedAgenceId={selectedAgenceId}
                  onSelectAgence={(id) => setSelectedAgenceId(id)}
                />
              </StatsSectionCard>

              <StatsSectionCard
                title="Carte du réseau"
                subtitle="Statut de chaque agence sur la période, comparé à son seuil d'alerte configuré."
              >
                {agencesCarte.avec.length > 0 ? (
                  <Suspense fallback={<div role="status" style={{ height: 420, display: 'grid', placeItems: 'center', color: 'var(--color-text-muted)' }}>Chargement de la carte…</div>}>
                    <AgencesMap agences={agencesCarte.avec} onVoirAgence={voirAgence} />
                  </Suspense>
                ) : (
                  <p style={{ margin: 0, textAlign: 'center', padding: 'var(--space-7) 0', color: 'var(--color-text-muted)' }}>
                    Aucune agence n'a de coordonnées géographiques : renseignez-les dans Gestion des agences.
                  </p>
                )}
              </StatsSectionCard>

              {agencesCarte.sans.length > 0 && (
                <StatsSectionCard title="Agences sans coordonnées" subtitle="Absentes de la carte, elles restent consultables ici et dans le classement.">
                  <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
                    {agencesCarte.sans.map((a) => (
                      <li key={a.id}>
                        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => voirAgence(a.id)}>
                          {a.nom}{a.ville ? ` · ${a.ville}` : ''} — {a.texte}
                        </button>
                      </li>
                    ))}
                  </ul>
                </StatsSectionCard>
              )}
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

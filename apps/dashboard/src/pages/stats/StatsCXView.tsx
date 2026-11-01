import React, { lazy, Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { statisticsApi, agencesApi } from '../../services/api';
import type { StatsCXResponse, Agence } from '../../types';
import TabsNavigation from '../../components/ui/TabsNavigation';
import PageTitle from '../../components/ui/PageTitle';
import PeriodSelector, { PERIOD_OPTIONS } from '../../components/stats/PeriodSelector';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import SatisfactionVolumeChart from '../../components/stats/SatisfactionVolumeChart';
import ThemesBarList from '../../components/stats/ThemesBarList';
import AgencesRankingTable from '../../components/stats/AgencesRankingTable';
import { LIBELLE_SCORE_FIABILISE } from '../../utils/scoreFiabilise';
import { lienAvisReseau } from '../../utils/liensAgence';
import type { AgenceCarte } from '../../components/map/AgencesMap';
import { statutSeuil, satisfactionTexte, STATUT_SEUIL_LABEL } from '../cx/siege/siegeData';

// Carte des agences (déplacée depuis le Dashboard CX) : chargée à la demande, Leaflet est lourd.
const AgencesMap = lazy(() => import('../../components/map/AgencesMap'));

type StatsTab = 'satisfaction' | 'agences';
const STATS_TABS: StatsTab[] = ['satisfaction', 'agences'];
const STATS_CX_PERIOD_OPTIONS = PERIOD_OPTIONS.map((option) =>
  option.jours === 1 ? { ...option, label: '24 dernières heures' } : option,
);
import {
  StatsLoadingState,
  StatsErrorState,
  StatsSectionCard,
} from '../../components/stats/StatsStates';
import { SmileIcon, StoreIcon } from '../../components/common/Icons';
import { userFacingError } from '../../utils/userFacingError';
import './statsCx.css';

export default function StatsCXView() {
  // Onglet piloté par l'URL (?tab=agences…) : le Dashboard CX peut pointer directement
  // sur Performance > Agences.
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
  const [showAllThemes, setShowAllThemes] = useState<boolean>(false);

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
      console.error('Erreur chargement statistiques:', err);
      setError(userFacingError(err, 'Impossible de charger les statistiques. Veuillez réessayer.'));
    } finally {
      setLoading(false);
    }
  }, [jours, selectedAgenceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
    { id: 'agences', label: 'Agences', icon: <StoreIcon size={16} />, badge: data?.agences_ranking.length },
  ];

  return (
    <div
      className="stats-cx"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%', maxWidth: '100%', minWidth: 0 }}
    >
      <PageTitle
        title="Statistiques et tendances"
        description="Analysez les performances, les avis et les thèmes du réseau. Pour suivre et traiter un problème signalé, ouvrez Problèmes à traiter."
        actions={
          <>
            <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
            <PeriodSelector value={jours} onChange={setJours} options={STATS_CX_PERIOD_OPTIONS} />
          </>
        }
      />

      {/* Navigation par vues analytiques */}
      <div className="stats-cx__tabs" role="group" aria-label="Vues des statistiques">
        <TabsNavigation
          tabs={tabsConfig}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as StatsTab)}
        />
      </div>
      <label className="stats-cx__mobile-view">
        <span>Vue</span>
        <select aria-label="Vue des statistiques" value={activeTab} onChange={(event) => setActiveTab(event.target.value as StatsTab)}>
          {tabsConfig.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
        </select>
      </label>

      {/* ── Gestion des États (Loading / Error) ── */}
      {loading && !data && <StatsLoadingState />}
      {loading && data && <div className="stats-cx__refresh" role="status" aria-live="polite">Mise à jour des statistiques…</div>}
      {error && !loading && <StatsErrorState message={error} onRetry={fetchData} />}

      {/* ── Contenu Organisé par Onglets ── */}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* ══════════════════════════════════════════════════════
              1. SATISFACTION (Analyse Approfondie du CSAT)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'satisfaction' && (() => {
            return (
              <div className="stats-cx__content">
                <StatsSectionCard compact title="Évolution de la satisfaction et du traitement" subtitle="La satisfaction concerne tous les avis notés; les volumes ne concernent que les avis négatifs ou critiques. Une interruption indique une période sans avis.">
                  <SatisfactionVolumeChart satisfaction={data.evolution_satisfaction} volume={data.evolution_volume} height={440} />
                </StatsSectionCard>
                <StatsSectionCard
                  compact
                  title="Thèmes les plus cités"
                  subtitle="Avis analysés pour l’agence et la période sélectionnées. La part porte sur les occurrences de thèmes attribuées; les avis sans thème en sont exclus."
                  action={data.themes.length > 5 && (
                    <button
                      type="button"
                      className="stats-cx__text-action"
                      aria-expanded={showAllThemes}
                      aria-controls="stats-cx-theme-list"
                      onClick={() => setShowAllThemes((visible) => !visible)}
                    >
                      {showAllThemes ? 'Réduire la liste' : 'Voir tous les thèmes'}
                    </button>
                  )}
                >
                  <div id="stats-cx-theme-list">
                    <ThemesBarList
                      themes={data.themes}
                      maxItems={showAllThemes ? data.themes.length : 5}
                      showSentiment={false}
                      lienTheme={(t) => lienAvisReseau({ theme: t.theme, jours, agenceId: selectedAgenceId })}
                    />
                  </div>
                  <p role="status" style={{ margin: '14px 0 0', fontSize: '0.76rem', color: '#64748B' }}>
                    {`Pourcentages calculés sur ${data.themes_total_avis ?? 0} occurrences de thèmes classifiées sur la période (et non sur l’ensemble des avis). Cliquez sur un thème pour voir les avis correspondants.`}
                  </p>
                </StatsSectionCard>
              </div>
            );
          })()}
          {/* ══════════════════════════════════════════════════════
              2. AGENCES (Classement & Benchmark Réseau)
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'agences' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <StatsSectionCard
                compact
                title="Classement des agences"
                subtitle={`Comparaison par ${LIBELLE_SCORE_FIABILISE.toLowerCase()}, satisfaction, avis pris en charge et avis critiques`}
              >
                <AgencesRankingTable
                  agences={data.agences_ranking}
                  selectedAgenceId={selectedAgenceId}
                  onSelectAgence={(id) => setSelectedAgenceId(id)}
                />
              </StatsSectionCard>

              <StatsSectionCard
                compact
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

        </div>
      )}
    </div>
  );
}

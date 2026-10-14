import React, { Dispatch, SetStateAction, useMemo } from 'react';
import type { Suggestion, IdeaStatus, HistoriqueSuggestion } from '../../types';
import TabsNavigation, { TabItem } from '../../components/ui/TabsNavigation';
import { ClockIcon, LightbulbIcon, CheckCircleIcon } from '../../components/common/Icons';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import { StatsErrorState } from '../../components/stats/StatsStates';
import SuggestionCarte from './SuggestionCarte';
import type { ResultatChangement } from './suggestionsHistorique';

type Props = {
  suggestions: Suggestion[]; suggestionsTotal: number; suggestionsLoading: boolean; suggestionsLoadingMore: boolean;
  suggestionsError: boolean; onRetrySuggestions: () => void;
  loadMoreSuggestions: () => void;
  /** Enregistre un changement de statut (commentaire facultatif). Un refus renvoie {ok:false, message}. */
  updateStatut: (id: string, statut: IdeaStatus, commentaire?: string) => Promise<ResultatChangement | void>;
  /** Historique complet d'une suggestion, chargé à la demande. Absent : pas de bouton d'historique. */
  chargerHistorique?: (id: string) => Promise<HistoriqueSuggestion[]>;
  activeSubTab: 'toutes' | 'a_etudier' | 'decisions'; setActiveSubTab: Dispatch<SetStateAction<'toutes' | 'a_etudier' | 'decisions'>>;
};

export default function PilotageIdeasTab({ suggestions, suggestionsTotal, suggestionsLoading, suggestionsLoadingMore, suggestionsError, onRetrySuggestions, loadMoreSuggestions, updateStatut, chargerHistorique, activeSubTab, setActiveSubTab }: Props) {
  const aEtudierCount = useMemo(() => suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours').length, [suggestions]);
  const decisionsCount = useMemo(() => suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete').length, [suggestions]);
  const filteredSuggestions = useMemo(() => {
    if (activeSubTab === 'a_etudier') return suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours');
    if (activeSubTab === 'decisions') return suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete');
    return suggestions;
  }, [suggestions, activeSubTab]);
  const ideesTabsConfig: TabItem[] = [
    { id: 'toutes', label: 'Toutes les idées', icon: <LightbulbIcon size={16} />, badge: suggestions.length },
    { id: 'a_etudier', label: 'À étudier', icon: <ClockIcon size={16} />, badge: aEtudierCount, badgeColor: aEtudierCount > 0 ? 'red' : 'default' },
    { id: 'decisions', label: 'Décisions prises', icon: <CheckCircleIcon size={16} />, badge: decisionsCount },
  ];
  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {suggestionsLoading ? (
            <div role="status" aria-busy="true" aria-label="Chargement des suggestions" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
              {[0, 1, 2].map((i) => <SkeletonBlock key={i} height={150} radius="var(--radius-2xl)" />)}
            </div>
          ) : suggestionsError && suggestions.length === 0 ? (
            <StatsErrorState message="Impossible de charger les suggestions." onRetry={onRetrySuggestions} />
          ) : (
            <>
              {suggestionsError && (
                <StatsErrorState message="Les suggestions n’ont pas pu être actualisées. La liste affichée peut être incomplète." onRetry={onRetrySuggestions} />
              )}
              <TabsNavigation tabs={ideesTabsConfig} activeTab={activeSubTab} onChange={(id) => setActiveSubTab(id as any)} />

              {filteredSuggestions.length === 0 ? (
                suggestions.length === 0 ? (
                  <EmptyState
                    illustration="no-data"
                    title="Aucune suggestion pour le moment"
                    message="Les idées déposées par les clients apparaîtront ici."
                  />
                ) : (
                  <EmptyState
                    illustration="no-data"
                    title="Aucune suggestion dans cette catégorie."
                    message="Changez d’onglet pour voir les autres suggestions."
                  />
                )
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
                  {filteredSuggestions.map((s) => (
                    <SuggestionCarte key={s.id} suggestion={s} updateStatut={updateStatut} chargerHistorique={chargerHistorique} />
                  ))}
                </div>
              )}
              {suggestions.length < suggestionsTotal && (
                <button type="button" onClick={loadMoreSuggestions} disabled={suggestionsLoadingMore} className="btn-secondary" style={{ alignSelf: 'center', minHeight: 44 }}>
                  {suggestionsLoadingMore ? 'Chargement…' : `Charger plus (${suggestions.length}/${suggestionsTotal})`}
                </button>
              )}
            </>
          )}
        </div>
  );
}

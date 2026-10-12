import React, { Dispatch, SetStateAction, useMemo } from 'react';
import type { Suggestion, IdeaStatus } from '../../types';
import TabsNavigation, { TabItem } from '../../components/ui/TabsNavigation';
import { ClockIcon, LightbulbIcon, CheckCircleIcon } from '../../components/common/Icons';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import { StatsErrorState } from '../../components/stats/StatsStates';
import { STATUS_LABELS, STATUS_STYLE, NEXT_STATUS } from './pilotageConstants';

type Props = {
  suggestions: Suggestion[]; suggestionsTotal: number; suggestionsLoading: boolean; suggestionsLoadingMore: boolean;
  suggestionsError: boolean; onRetrySuggestions: () => void;
  loadMoreSuggestions: () => void; updateStatut: (id: string, statut: IdeaStatus) => Promise<void>;
  activeSubTab: 'toutes' | 'a_etudier' | 'decisions'; setActiveSubTab: Dispatch<SetStateAction<'toutes' | 'a_etudier' | 'decisions'>>;
};

export default function PilotageIdeasTab({ suggestions, suggestionsTotal, suggestionsLoading, suggestionsLoadingMore, suggestionsError, onRetrySuggestions, loadMoreSuggestions, updateStatut, activeSubTab, setActiveSubTab }: Props) {
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
            <div role="status" aria-busy="true" aria-label="Chargement des suggestions" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                  {filteredSuggestions.map((s) => {
                    const st = STATUS_STYLE[s.statut] || { bg: '#F8FAFB', text: '#475569', border: '#E2E8F0' };
                    const next = NEXT_STATUS[s.statut];
                    return (
                      <div
                        key={s.id}
                        style={{
                          background: '#FFFFFF',
                          borderRadius: '20px',
                          padding: '22px',
                          border: '1px solid #E8ECE6',
                          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '16px',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, padding: '3px 10px', borderRadius: '9999px', fontSize: '0.74rem', fontWeight: 800 }}>
                              {STATUS_LABELS[s.statut]}
                            </span>
                            <span style={{ fontSize: '0.76rem', color: '#64748B', fontWeight: 600 }}>
                              {new Date(s.date_soumission).toLocaleDateString('fr-FR')}
                            </span>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5, fontWeight: 500 }}>"{s.contenu}"</p>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid #F1F4EE', paddingTop: '12px' }}>
                          {next && (
                            <button
                              type="button"
                              onClick={() => updateStatut(s.id, next)}
                              className="btn-primary"
                              style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: '10px' }}
                            >
                              → Passer à "{STATUS_LABELS[next]}"
                            </button>
                          )}
                          {s.statut !== 'rejete' && (
                            <button
                              type="button"
                              onClick={() => updateStatut(s.id, 'rejete')}
                              style={{ background: '#FFFFFF', color: '#DC2626', border: '1px solid #FEE2E2', borderRadius: '10px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                            >
                              Rejeter
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {suggestions.length < suggestionsTotal && (
                <button type="button" onClick={loadMoreSuggestions} disabled={suggestionsLoadingMore} className="btn-secondary" style={{ alignSelf: 'center' }}>
                  {suggestionsLoadingMore ? 'Chargement…' : `Charger plus (${suggestions.length}/${suggestionsTotal})`}
                </button>
              )}
            </>
          )}
        </div>
  );
}

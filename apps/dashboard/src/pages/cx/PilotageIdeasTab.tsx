import React, { Dispatch, SetStateAction, useMemo } from 'react';
import type { Suggestion, IdeaStatus } from '../../types';
import TabsNavigation, { TabItem } from '../../components/ui/TabsNavigation';
import { ClockIcon, LightbulbIcon, CheckCircleIcon } from '../../components/common/Icons';
import { STATUS_LABELS, STATUS_STYLE, NEXT_STATUS } from './pilotageConstants';

type Props = {
  suggestions: Suggestion[]; suggestionsTotal: number; suggestionsLoading: boolean; suggestionsLoadingMore: boolean;
  loadMoreSuggestions: () => void; updateStatut: (id: string, statut: IdeaStatus) => Promise<void>;
  activeSubTab: 'toutes' | 'a_etudier' | 'decisions'; setActiveSubTab: Dispatch<SetStateAction<'toutes' | 'a_etudier' | 'decisions'>>;
};

export default function PilotageIdeasTab({ suggestions, suggestionsTotal, suggestionsLoading, suggestionsLoadingMore, loadMoreSuggestions, updateStatut, activeSubTab, setActiveSubTab }: Props) {
  const aEtudierCount = useMemo(() => suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours').length, [suggestions]);
  const decisionsCount = useMemo(() => suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete').length, [suggestions]);
  const filteredSuggestions = useMemo(() => {
    if (activeSubTab === 'a_etudier') return suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours');
    if (activeSubTab === 'decisions') return suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete');
    return suggestions;
  }, [suggestions, activeSubTab]);
  const ideesTabsConfig: TabItem[] = [
    { id: 'toutes', label: 'Toutes les id?es', icon: <LightbulbIcon size={16} />, badge: suggestions.length },
    { id: 'a_etudier', label: '? ?tudier', icon: <ClockIcon size={16} />, badge: aEtudierCount, badgeColor: aEtudierCount > 0 ? 'red' : 'default' },
    { id: 'decisions', label: 'D?cisions prises', icon: <CheckCircleIcon size={16} />, badge: decisionsCount },
  ];
  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {suggestionsLoading ? (
            <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des suggestions...</div>
          ) : (
            <>
              <TabsNavigation tabs={ideesTabsConfig} activeTab={activeSubTab} onChange={(id) => setActiveSubTab(id as any)} />

              {filteredSuggestions.length === 0 ? (
                <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '48px', textAlign: 'center', color: '#64748B', border: '1px solid #E8ECE6', fontWeight: 600 }}>
                  Aucune suggestion dans cette catégorie.
                </div>
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
                            <span style={{ fontSize: '0.76rem', color: '#94A3B8', fontWeight: 600 }}>
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

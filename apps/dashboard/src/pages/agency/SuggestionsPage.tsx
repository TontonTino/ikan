import React, { useEffect, useState, useMemo } from 'react';
import { suggestionsApi } from '../../services/api';
import type { Suggestion, IdeaStatus } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import TabsNavigation from '../../components/ui/TabsNavigation';
import { LightbulbIcon, ClockIcon, CheckCircleIcon } from '../../components/common/Icons';

const STATUS_LABELS: Record<IdeaStatus, string> = {
  nouveau: 'Nouveau',
  en_cours: 'En cours',
  traite: 'Traité',
  rejete: 'Rejeté',
};

const STATUS_STYLE: Record<IdeaStatus, { bg: string; text: string; border: string }> = {
  nouveau: { bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD' },
  en_cours: { bg: '#FEF3C7', text: '#B45309', border: '#FDE68A' },
  traite: { bg: '#EBF5E9', text: '#3C7730', border: '#D5E8D3' },
  rejete: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
};

const NEXT_STATUS: Record<IdeaStatus, IdeaStatus | null> = {
  nouveau: 'en_cours',
  en_cours: 'traite',
  traite: null,
  rejete: null,
};

export default function SuggestionsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'toutes' | 'a_etudier' | 'decisions'>('toutes');
  const [toast, setToast] = useState('');

  useEffect(() => {
    suggestionsApi
      .list()
      .then((r) => {
        setSuggestions(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const updateStatut = async (id: string, statut: IdeaStatus) => {
    try {
      await suggestionsApi.updateStatut(id, statut);
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, statut } : s)));
      showToast(`Statut mis à jour : ${STATUS_LABELS[statut]}`);
    } catch {
      showToast('Erreur lors de la mise à jour');
    }
  };

  const aEtudierCount = useMemo(() => {
    return suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours').length;
  }, [suggestions]);

  const decisionsCount = useMemo(() => {
    return suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete').length;
  }, [suggestions]);

  const filteredSuggestions = useMemo(() => {
    if (activeTab === 'a_etudier') {
      return suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours');
    }
    if (activeTab === 'decisions') {
      return suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete');
    }
    return suggestions;
  }, [suggestions, activeTab]);

  const tabsConfig = [
    { id: 'toutes', label: 'Toutes les idées', icon: <LightbulbIcon size={16} />, badge: suggestions.length },
    {
      id: 'a_etudier',
      label: 'À étudier',
      icon: <ClockIcon size={16} />,
      badge: aEtudierCount,
      badgeColor: aEtudierCount > 0 ? ('red' as const) : ('default' as const),
    },
    { id: 'decisions', label: 'Décisions prises', icon: <CheckCircleIcon size={16} />, badge: decisionsCount },
  ];

  if (loading) return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des suggestions...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 1000,
            background: '#02302D',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
            fontSize: '0.88rem',
            fontWeight: 700,
          }}
        >
          {toast}
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title={`Boîte à Idées (${suggestions.length})`}
        subtitle="Idées d'amélioration et suggestions innovantes soumises spontanément par vos clients."
      />

      {/* Navigation par 3 Onglets */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* Liste des Suggestions */}
      {filteredSuggestions.length === 0 ? (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '24px',
            padding: '48px',
            textAlign: 'center',
            color: '#64748B',
            border: '1px solid #E8ECE6',
            fontWeight: 600,
          }}
        >
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
                    <span
                      style={{
                        background: st.bg,
                        color: st.text,
                        border: `1px solid ${st.border}`,
                        padding: '3px 10px',
                        borderRadius: '9999px',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                      }}
                    >
                      {STATUS_LABELS[s.statut]}
                    </span>
                    <span style={{ fontSize: '0.76rem', color: '#94A3B8', fontWeight: 600 }}>
                      {new Date(s.date_soumission).toLocaleDateString('fr-FR')}
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5, fontWeight: 500 }}>
                    "{s.contenu}"
                  </p>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    justifyContent: 'flex-end',
                    borderTop: '1px solid #F1F4EE',
                    paddingTop: '12px',
                  }}
                >
                  {next && (
                    <button
                      type="button"
                      onClick={() => updateStatut(s.id, next)}
                      style={{
                        background: '#02302D',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      → Passer à "{STATUS_LABELS[next]}"
                    </button>
                  )}
                  {s.statut !== 'rejete' && (
                    <button
                      type="button"
                      onClick={() => updateStatut(s.id, 'rejete')}
                      style={{
                        background: '#FFFFFF',
                        color: '#DC2626',
                        border: '1px solid #FEE2E2',
                        borderRadius: '10px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
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
    </div>
  );
}

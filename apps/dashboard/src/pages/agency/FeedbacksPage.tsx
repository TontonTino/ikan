import React, { useEffect, useState, useMemo } from 'react';
import { feedbacksApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Feedback, Agence, StatutTraitement } from '../../types';
import FeedbackTreatmentModal from '../../components/feedbacks/FeedbackTreatmentModal';
import PageHeader from '../../components/ui/PageHeader';
import KpiCard from '../../components/ui/KpiCard';
import TabsNavigation from '../../components/ui/TabsNavigation';
import {
  MessageSquareIcon,
  SearchIcon,
  FilterIcon,
  StoreIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  PhoneIcon,
  TagIcon,
  ClockIcon,
  RefreshIcon,
  SmileIcon,
} from '../../components/common/Icons';

const STATUT_BADGES: Record<StatutTraitement, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  nouveau: { label: 'Nouveau', bg: '#FEE2E2', text: '#DC2626', icon: <AlertTriangleIcon size={12} color="#DC2626" /> },
  en_traitement: { label: 'En traitement', bg: '#E0F2FE', text: '#0369A1', icon: <ClockIcon size={12} color="#0369A1" /> },
  en_cours: { label: 'En cours', bg: '#FEF3C7', text: '#D97706', icon: <ClockIcon size={12} color="#D97706" /> },
  resolu: { label: 'Résolu', bg: '#EBF5E9', text: '#3C7730', icon: <CheckCircleIcon size={12} color="#3C7730" /> },
};

const SENTIMENT_STYLE: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
  positif: { bg: '#EBF5E9', text: '#3C7730', label: 'Positif', icon: <ThumbsUpIcon size={13} color="#3C7730" /> },
  neutre: { bg: '#FEF3C7', text: '#B45309', label: 'Neutre', icon: <span style={{ fontSize: '0.85rem' }}>😐</span> },
  negatif: { bg: '#FEE2E2', text: '#B91C1C', label: 'Négatif', icon: <ThumbsDownIcon size={13} color="#B91C1C" /> },
};

const CRITICITE_STYLE: Record<string, { bg: string; text: string }> = {
  faible: { bg: '#F1F5F9', text: '#475569' },
  moyenne: { bg: '#E0F2FE', text: '#0369A1' },
  elevee: { bg: '#FFEDD5', text: '#C2410C' },
  critique: { bg: '#FEE2E2', text: '#DC2626' },
};

const THEME_LABELS: Record<string, string> = {
  attente: 'Attente & Délais en caisse',
  accueil: 'Accueil & Conseillers',
  disponibilite_accessibilite: 'Accessibilité & Horaires',
  tarifs: 'Tarifs & Frais',
  qualite_produit: 'Qualité Produit & Forfaits',
  proprete_cadre: 'Propreté & Cadre agence',
  application_mobile: 'Application Mobile & E-espace',
  reseau: 'Réseau 4G/5G & Connexion',
  facturation: 'Facturation & Prélèvements',
  communication_information: 'Communication & Conseils',
  livraison_logistique: 'Livraison & Disponibilité SIM',
  resolution_probleme: 'SAV & Résolution',
  securite_confidentialite: 'Sécurité & Confidentialité',
  disponibilite_produit: 'Disponibilité Stocks / Terminaux',
  personnalisation_besoin: 'Écoute & Personnalisation',
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const normalizeSentiment = (sentiment?: string): string => {
  if (!sentiment) return '';
  const s = sentiment.toLowerCase().trim();
  if (s === 'positive') return 'positif';
  if (s === 'negative') return 'negatif';
  if (s === 'neutral') return 'neutre';
  return s;
};

const normalizeCriticite = (criticite?: string): string => {
  if (!criticite) return '';
  return criticite.toLowerCase().trim();
};

export default function FeedbacksPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isCXOrAdmin = currentUser?.role === 'cx_manager' || currentUser?.role === 'admin';
  const isAllowedToTreat = currentUser?.role === 'agency_manager' || currentUser?.role === 'cx_manager';

  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [agences, setAgences] = useState<Agence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [toast, setToast] = useState('');
  const [selectedFeedbackForTreatment, setSelectedFeedbackForTreatment] = useState<Feedback | null>(null);

  // 4 Onglets Spécifiés
  const [activeTab, setActiveTab] = useState<'tous' | 'a_traiter' | 'critiques' | 'thematiques'>('tous');

  // Filtres
  const [selectedAgenceId, setSelectedAgenceId] = useState<string>('all');
  const [filterSentiment, setFilterSentiment] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const fRes = await feedbacksApi.list({ limit: 250 });
        if (!cancelled) setFeedbacks(fRes?.data || []);

        if (isCXOrAdmin) {
          const aRes = await agencesApi.list();
          if (!cancelled && aRes?.data) setAgences(aRes.data);
        }
      } catch (err) {
        console.error('Erreur chargement:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [isCXOrAdmin, refreshTrigger]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleUpdateSingleFeedback = (updated: Feedback) => {
    setFeedbacks((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    if (selectedFeedbackForTreatment?.id === updated.id) {
      setSelectedFeedbackForTreatment(updated);
    }
  };

  // Filtrage selon l'onglet et les critères
  const tabFeedbacks = useMemo(() => {
    return feedbacks.filter((f) => {
      // 1. Filtrage selon l'onglet actif
      if (activeTab === 'a_traiter') {
        const statut = f.statut_traitement || 'nouveau';
        const needsAction = statut !== 'resolu' || (f.demande_contact && !f.demande_contact.traitee);
        if (!needsAction) return false;
      }
      if (activeTab === 'critiques') {
        const crit = normalizeCriticite(f.analyse_ia?.criticite);
        const sent = normalizeSentiment(f.analyse_ia?.sentiment);
        const isCrit = crit === 'critique' || crit === 'elevee' || sent === 'negatif' || f.analyse_ia?.discordance_detectee;
        if (!isCrit) return false;
      }

      // 2. Filtres généraux (agence, sentiment, thème, recherche)
      if (selectedAgenceId !== 'all' && f.agence_id !== selectedAgenceId) return false;
      if (filterSentiment !== 'all' && normalizeSentiment(f.analyse_ia?.sentiment) !== filterSentiment) return false;
      if (filterTheme !== 'all' && f.analyse_ia?.theme_principal !== filterTheme) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const comment = (f.commentaire || '').toLowerCase();
        const canal = (f.canal || '').toLowerCase();
        if (!comment.includes(q) && !canal.includes(q)) return false;
      }
      return true;
    });
  }, [feedbacks, activeTab, selectedAgenceId, filterSentiment, filterTheme, search]);

  // Statistiques pour les badges d'onglets
  const aTraiterCount = useMemo(() => {
    return feedbacks.filter((f) => (f.statut_traitement || 'nouveau') !== 'resolu' || (f.demande_contact && !f.demande_contact.traitee)).length;
  }, [feedbacks]);

  const critiquesCount = useMemo(() => {
    return feedbacks.filter((f) => {
      const crit = normalizeCriticite(f.analyse_ia?.criticite);
      return crit === 'critique' || crit === 'elevee';
    }).length;
  }, [feedbacks]);

  // Agrégation des 15 Thématiques IA
  const themesAggregated = useMemo(() => {
    const map: Record<string, { theme: string; label: string; count: number; positifs: number; negatifs: number; agences: Set<string>; verbatims: string[] }> = {};
    Object.keys(THEME_LABELS).forEach((t) => {
      map[t] = { theme: t, label: THEME_LABELS[t], count: 0, positifs: 0, negatifs: 0, agences: new Set(), verbatims: [] };
    });

    feedbacks.forEach((f) => {
      const tKey = f.analyse_ia?.theme_principal;
      if (tKey && map[tKey]) {
        map[tKey].count += 1;
        const s = normalizeSentiment(f.analyse_ia?.sentiment);
        if (s === 'positif') map[tKey].positifs += 1;
        if (s === 'negatif') map[tKey].negatifs += 1;
        if (f.agence_nom) map[tKey].agences.add(f.agence_nom);
        if (f.commentaire && map[tKey].verbatims.length < 3) {
          map[tKey].verbatims.push(f.commentaire);
        }
      }
    });

    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [feedbacks]);

  const tabsConfig = [
    { id: 'tous', label: 'Tous les feedbacks', icon: <MessageSquareIcon size={16} />, badge: feedbacks.length },
    {
      id: 'a_traiter',
      label: 'À traiter',
      icon: <ClockIcon size={16} />,
      badge: aTraiterCount,
      badgeColor: aTraiterCount > 0 ? ('red' as const) : ('default' as const),
    },
    {
      id: 'critiques',
      label: 'Critiques & Alertes',
      icon: <AlertTriangleIcon size={16} />,
      badge: critiquesCount,
      badgeColor: critiquesCount > 0 ? ('red' as const) : ('default' as const),
    },
    { id: 'thematiques', label: 'Thématiques IA (15)', icon: <TagIcon size={16} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 600 }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Feedbacks Clients"
        subtitle="Flux complet des avis clients collectés, analysés par l'IA et traités par les équipes"
        onRefresh={() => setRefreshTrigger((p) => p + 1)}
      >
        {isCXOrAdmin && (
          <select
            value={selectedAgenceId}
            onChange={(e) => setSelectedAgenceId(e.target.value)}
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '8px 14px',
              fontSize: '0.80rem',
              fontWeight: 600,
              color: '#0F172A',
              outline: 'none',
            }}
          >
            <option value="all">Toutes les agences</option>
            {agences.map((a) => (
              <option key={a.id} value={a.id}>{a.nom}</option>
            ))}
          </select>
        )}
      </PageHeader>

      {/* Navigation par Onglets */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* ── ONGLET 1, 2, 3 : VUES TABLEAU DE FEEDBACKS ── */}
      {activeTab !== 'thematiques' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Barre de Recherche et Filtres */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '18px',
              padding: '14px 20px',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 260px' }}>
              <SearchIcon size={16} color="#94A3B8" />
              <input
                type="text"
                placeholder="Rechercher par mot-clé, canal, etc..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  border: 'none',
                  outline: 'none',
                  width: '100%',
                  fontSize: '0.84rem',
                  fontFamily: 'inherit',
                  color: '#0F172A',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Filtre Sentiment */}
              <select
                value={filterSentiment}
                onChange={(e) => setFilterSentiment(e.target.value)}
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '10px',
                  padding: '6px 10px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#0F172A',
                }}
              >
                <option value="all">Tous sentiments</option>
                <option value="positif">Positif</option>
                <option value="neutre">Neutre</option>
                <option value="negatif">Négatif</option>
              </select>

              {/* Filtre Thème */}
              <select
                value={filterTheme}
                onChange={(e) => setFilterTheme(e.target.value)}
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '10px',
                  padding: '6px 10px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#0F172A',
                }}
              >
                <option value="all">Tous thèmes</option>
                {Object.entries(THEME_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tableau des Feedbacks */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '20px',
              border: '1px solid #E8ECE6',
              boxShadow: '0 2px 12px rgba(20, 60, 40, 0.03)',
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E8ECE6', background: '#F8FAFB' }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Date & Agence</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Note & Sentiment</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Verbatim Client</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Thème IA</th>
                  <th style={{ textAlign: 'center', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Statut</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {tabFeedbacks.length > 0 ? (
                  tabFeedbacks.map((f) => {
                    const sKey = normalizeSentiment(f.analyse_ia?.sentiment);
                    const sentMeta = SENTIMENT_STYLE[sKey] || { bg: '#F1F5F9', text: '#64748B', label: sKey || '—', icon: null };
                    const statKey = (f.statut_traitement || 'nouveau') as StatutTraitement;
                    const statMeta = STATUT_BADGES[statKey] || STATUT_BADGES.nouveau;

                    return (
                      <tr
                        key={f.id}
                        style={{ borderBottom: '1px solid #F1F4EE', cursor: 'pointer' }}
                        onClick={() => setSelectedFeedbackForTreatment(f)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
                      >
                        {/* Date & Agence */}
                        <td style={{ padding: '14px 16px', minWidth: '140px' }}>
                          <div style={{ fontWeight: 700, color: '#02302D' }}>{f.agence_nom || 'Agence'}</div>
                          <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: '2px' }}>
                            {formatDate(f.created_at)}
                          </div>
                        </td>

                        {/* Note & Sentiment */}
                        <td style={{ padding: '14px 16px', minWidth: '120px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 800, color: '#0F172A', fontSize: '0.90rem' }}>
                              ★ {f.note}/5
                            </span>
                            <span
                              style={{
                                background: sentMeta.bg,
                                color: sentMeta.text,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontSize: '0.70rem',
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                              }}
                            >
                              {sentMeta.icon}
                              {sentMeta.label}
                            </span>
                          </div>
                        </td>

                        {/* Verbatim */}
                        <td style={{ padding: '14px 16px', maxWidth: '340px' }}>
                          <div style={{ color: '#334155', lineHeight: 1.4, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {f.commentaire || 'Aucun commentaire texte rédigé.'}
                          </div>
                        </td>

                        {/* Thème IA */}
                        <td style={{ padding: '14px 16px', minWidth: '140px' }}>
                          <span
                            style={{
                              background: '#F1F5F9',
                              color: '#475569',
                              padding: '4px 10px',
                              borderRadius: '8px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                            }}
                          >
                            {THEME_LABELS[f.analyse_ia?.theme_principal || ''] || THEME_LABELS['accueil']}
                          </span>
                        </td>

                        {/* Statut */}
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          <span
                            style={{
                              background: statMeta.bg,
                              color: statMeta.text,
                              padding: '3px 10px',
                              borderRadius: '9999px',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            {statMeta.icon}
                            {statMeta.label}
                          </span>
                        </td>

                        {/* Action */}
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFeedbackForTreatment(f);
                            }}
                            style={{
                              background: '#02302D',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '10px',
                              padding: '6px 12px',
                              fontSize: '0.76rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Consulter
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: '#94A3B8' }}>
                      Aucun feedback trouvé pour les critères sélectionnés.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ONGLET 4 : THÉMATIQUES IA (15 THÈMES) ── */}
      {activeTab === 'thematiques' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '16px',
          }}
        >
          {themesAggregated.map((thm) => (
            <div
              key={thm.theme}
              style={{
                background: '#FFFFFF',
                borderRadius: '20px',
                padding: '20px 24px',
                border: '1px solid #E8ECE6',
                boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '14px',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#02302D' }}>
                    {thm.label}
                  </span>
                  <span style={{ background: '#02302D', color: '#FFFFFF', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 800 }}>
                    {thm.count} avis
                  </span>
                </div>

                {/* Sentiments Ratio */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ background: '#EBF6ED', color: '#3C7730', padding: '2px 6px', borderRadius: '6px', fontSize: '0.70rem', fontWeight: 700 }}>
                    👍 {thm.positifs} pos
                  </span>
                  <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '2px 6px', borderRadius: '6px', fontSize: '0.70rem', fontWeight: 700 }}>
                    👎 {thm.negatifs} nég
                  </span>
                  <span style={{ color: '#64748B', fontSize: '0.70rem', marginLeft: 'auto', alignSelf: 'center' }}>
                    📍 {thm.agences.size} agences concernées
                  </span>
                </div>

                {/* Exemples de Verbatims */}
                {thm.verbatims.length > 0 && (
                  <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '10px 12px', fontSize: '0.78rem', color: '#475569', fontStyle: 'italic', lineHeight: 1.4 }}>
                    "{thm.verbatims[0]}"
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setFilterTheme(thm.theme);
                  setActiveTab('tous');
                }}
                style={{
                  background: '#EBF6ED',
                  color: '#3C7730',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '8px',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                Voir les {thm.count} avis de ce thème →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modale Éphémère de Traitement SaaS */}
      {selectedFeedbackForTreatment && (
        <FeedbackTreatmentModal
          feedback={selectedFeedbackForTreatment}
          isOpen={true}
          onClose={() => setSelectedFeedbackForTreatment(null)}
          onUpdateFeedback={handleUpdateSingleFeedback}
          currentUserRole={currentUser?.role}
          currentUserName={currentUser ? `${currentUser.prenom} ${currentUser.nom}` : undefined}
        />
      )}
    </div>
  );
}

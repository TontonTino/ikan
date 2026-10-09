import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { feedbacksApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Feedback, Agence, StatutTraitement, CriticiteType } from '../../types';
import FeedbackTreatmentModal from '../../components/feedbacks/FeedbackTreatmentModal';
import KpiCard from '../../components/ui/KpiCard';
import TabsNavigation from '../../components/ui/TabsNavigation';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
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
  XCloseIcon,
} from '../../components/common/Icons';
import { themeLabel } from '../../utils/themeLabels';
import { AVIS_STATUT_LABELS, GRAVITE_LABELS } from '../../utils/vocabulaire';
import './FeedbacksPage.css';

const STATUT_BADGES: Record<StatutTraitement, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  nouveau: { label: AVIS_STATUT_LABELS.nouveau, bg: '#FEE2E2', text: '#DC2626', icon: <AlertTriangleIcon size={12} color="#DC2626" /> },
  en_traitement: { label: AVIS_STATUT_LABELS.en_traitement, bg: '#E0F2FE', text: '#0369A1', icon: <ClockIcon size={12} color="#0369A1" /> },
  en_cours: { label: AVIS_STATUT_LABELS.en_cours, bg: '#FEF3C7', text: '#D97706', icon: <ClockIcon size={12} color="#D97706" /> },
  resolu: { label: AVIS_STATUT_LABELS.resolu, bg: '#EBF5E9', text: '#3C7730', icon: <CheckCircleIcon size={12} color="#3C7730" /> },
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

// Les filtres sentiment/thème restent côté client, sur les pages chargées progressivement.
const FETCH_LIMIT = 50;
const PAGE_SIZE = 25;

const formatDate = (dateStr?: string) => {
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

const dateDebutPeriode = (periode: string) => {
  if (periode === 'all') return null;
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (periode === 'today') return date;
  date.setDate(date.getDate() - (periode === '7' ? 6 : 29));
  return date;
};

const sentimentDominant = (positifs: number, negatifs: number, neutres: number) => {
  const sentiments = [['positif', positifs], ['négatif', negatifs], ['neutre', neutres]] as const;
  const maximum = Math.max(positifs, negatifs, neutres);
  if (maximum === 0) return 'non évalué';
  const dominants = sentiments.filter(([, count]) => count === maximum).map(([label]) => label);
  return dominants.length > 1 ? `à égalité (${dominants.join(', ')})` : dominants[0];
};

const hasAttentionSignal = (feedback: Feedback) => {
  const criticite = normalizeCriticite(feedback.analyse_ia?.criticite);
  const sentiment = normalizeSentiment(feedback.analyse_ia?.sentiment);
  return criticite === 'critique' || criticite === 'elevee' || sentiment === 'negatif' || Boolean(feedback.analyse_ia?.discordance_detectee);
};

const needsTreatment = (feedback: Feedback) => {
  const statut = feedback.statut_traitement || 'nouveau';
  return statut !== 'resolu' || Boolean(feedback.demande_contact && !feedback.demande_contact.traitee);
};

interface FeedbacksPageProps {
  /**
   * Agence fixe (page agence unifiée, onglet Feedbacks) : quand fourni, le
   * sélecteur d'agence est masqué et la liste est filtrée côté serveur sur
   * cette seule agence — le composant reste utilisable tel quel (sans prop)
   * pour la route /feedbacks classique, comportement inchangé dans ce cas.
   */
  agenceId?: string;
}

export default function FeedbacksPage({ agenceId }: FeedbacksPageProps = {}) {
  const [searchParams] = useSearchParams();
  const currentUser = useAuthStore((s) => s.user);
  const isCXOrAdmin = currentUser?.role === 'cx_manager' || currentUser?.role === 'admin';
  const isAllowedToTreat = currentUser?.role === 'agency_manager' || currentUser?.role === 'cx_manager';
  // Le sélecteur d'agence n'a de sens que si l'agence n'est pas déjà fixée par le contexte de la page.
  const showAgenceSelector = isCXOrAdmin && !agenceId;

  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [agences, setAgences] = useState<Agence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [toast, setToast] = useState('');
  const [selectedFeedbackForTreatment, setSelectedFeedbackForTreatment] = useState<Feedback | null>(null);

  // 4 Onglets Spécifiés
  const tabsValides = ['tous', 'a_traiter', 'critiques', 'thematiques'] as const;
  type FeedbackTab = (typeof tabsValides)[number];
  const [activeTab, setActiveTab] = useState<FeedbackTab>(() => {
    const requestedTab = searchParams.get('tab');
    return tabsValides.includes(requestedTab as FeedbackTab) ? (requestedTab as FeedbackTab) : 'tous';
  });

  // Filtres
  const [selectedAgenceId, setSelectedAgenceId] = useState<string>(agenceId || 'all');
  const [filterSentiment, setFilterSentiment] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>(() => searchParams.get('theme') || 'all');
  const [filterNote, setFilterNote] = useState<string>('all');
  const [filterCriticite, setFilterCriticite] = useState<string>('all');
  const [filterPeriode, setFilterPeriode] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 700px)').matches);

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 700px)');
    const syncFilterPanel = () => setFiltersOpen(!mobileQuery.matches);
    mobileQuery.addEventListener('change', syncFilterPanel);
    return () => mobileQuery.removeEventListener('change', syncFilterPanel);
  }, []);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    setActiveTab(tabsValides.includes(requestedTab as FeedbackTab) ? (requestedTab as FeedbackTab) : 'tous');
    setFilterTheme(searchParams.get('theme') || 'all');
    setPage(0);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setLoadError(false);
      try {
        try {
          const agenceFiltre = agenceId || (selectedAgenceId !== 'all' ? selectedAgenceId : undefined);
          const fRes = await feedbacksApi.list({ limit: FETCH_LIMIT, offset: 0, ...(agenceFiltre ? { agence_id: agenceFiltre } : {}) });
          if (!cancelled) {
            setFeedbacks(fRes?.data || []);
            const totalHeader = Number(fRes?.headers?.['x-total-count']);
            setFeedbackTotal(Number.isFinite(totalHeader) ? totalHeader : (fRes?.data || []).length);
          }
        } catch (err) {
          console.error('Erreur chargement:', err);
          if (!cancelled) {
            setFeedbacks([]);
            setFeedbackTotal(0);
            setLoadError(true);
          }
        }
        if (showAgenceSelector) {
          try {
            const aRes = await agencesApi.list();
            if (!cancelled && aRes?.data) setAgences(aRes.data);
          } catch (err) {
            // Une indisponibilité du sélecteur d'agence ne doit pas masquer la liste déjà chargée.
            console.error('Erreur chargement des agences:', err);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [showAgenceSelector, agenceId, selectedAgenceId, reloadToken]);

  const loadMoreFeedbacks = async () => {
    if (loadingMore || feedbacks.length >= feedbackTotal) return;
    setLoadingMore(true);
    try {
      const agenceFiltre = agenceId || (selectedAgenceId !== 'all' ? selectedAgenceId : undefined);
      const response = await feedbacksApi.list({ limit: FETCH_LIMIT, offset: feedbacks.length, ...(agenceFiltre ? { agence_id: agenceFiltre } : {}) });
      setFeedbacks((current) => [...current, ...(response?.data || [])]);
    } catch (err) {
      console.error('Erreur chargement des feedbacks suivants:', err);
      showToast('Impossible de charger les avis suivants');
    } finally {
      setLoadingMore(false);
    }
  };

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

  // Les vues et leurs compteurs partagent exactement le même périmètre local.
  const filteredFeedbacks = useMemo(() => {
    return feedbacks.filter((f) => {
      if (selectedAgenceId !== 'all' && f.agence_id !== selectedAgenceId) return false;
      if (filterSentiment !== 'all' && normalizeSentiment(f.analyse_ia?.sentiment) !== filterSentiment) return false;
      if (filterTheme === 'non_categorise' ? Boolean(f.analyse_ia?.theme_principal) : filterTheme !== 'all' && f.analyse_ia?.theme_principal !== filterTheme) return false;
      if (filterNote !== 'all' && f.note !== Number(filterNote)) return false;
      if (filterCriticite !== 'all') {
        const hasAnalysis = Boolean(f.analyse_ia);
        const criticite = normalizeCriticite(f.analyse_ia?.criticite);
        if (filterCriticite === 'non_evaluee' ? (!hasAnalysis || Boolean(criticite)) : criticite !== filterCriticite) return false;
      }
      const debutPeriode = dateDebutPeriode(filterPeriode);
      if (debutPeriode) {
        const dateFeedback = new Date(f.date_soumission);
        if (Number.isNaN(dateFeedback.getTime()) || dateFeedback < debutPeriode) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const comment = (f.commentaire || '').toLowerCase();
        if (!comment.includes(q)) return false;
      }
      return true;
    });
  }, [feedbacks, selectedAgenceId, filterSentiment, filterTheme, filterNote, filterCriticite, filterPeriode, search]);

  const tabFeedbacks = useMemo(() => filteredFeedbacks.filter((feedback) => {
    if (activeTab === 'a_traiter') return needsTreatment(feedback);
    if (activeTab === 'critiques') return hasAttentionSignal(feedback);
    return true;
  }), [filteredFeedbacks, activeTab]);

  // Statistiques pour les badges d'onglets
  const aTraiterCount = useMemo(() => {
    return filteredFeedbacks.filter(needsTreatment).length;
  }, [filteredFeedbacks]);

  const critiquesCount = useMemo(() => {
    return filteredFeedbacks.filter(hasAttentionSignal).length;
  }, [filteredFeedbacks]);

  // Thèmes réellement présents dans les feedbacks : catégories libres définies par le
  // CX Manager par agence (plus les anciennes clés IA à 15 thèmes pour les feedbacks legacy).
  const themesDisponibles = useMemo(() => {
    const set = new Set<string>();
    feedbacks.forEach((f) => {
      if (f.analyse_ia?.theme_principal) set.add(f.analyse_ia.theme_principal);
      else set.add('non_categorise');
    });
    if (filterTheme !== 'all') set.add(filterTheme);
    return Array.from(set).sort((a, b) => themeLabel(a).localeCompare(themeLabel(b)));
  }, [feedbacks, filterTheme]);

  // Agrégation dynamique par catégorie/thème (plus de liste figée à 15 entrées)
  const themesAggregated = useMemo(() => {
    const map: Record<string, { theme: string; label: string; count: number; positifs: number; negatifs: number; neutres: number; criticites: Record<string, number>; agences: Set<string>; verbatims: string[] }> = {};

    feedbacks.forEach((f) => {
      const tKey = f.analyse_ia?.theme_principal || 'non_categorise';
      if (!map[tKey]) {
        map[tKey] = { theme: tKey, label: tKey === 'non_categorise' ? 'Non catégorisé' : themeLabel(tKey), count: 0, positifs: 0, negatifs: 0, neutres: 0, criticites: {}, agences: new Set(), verbatims: [] };
      }
      map[tKey].count += 1;
      const s = normalizeSentiment(f.analyse_ia?.sentiment);
      if (s === 'positif') map[tKey].positifs += 1;
      if (s === 'negatif') map[tKey].negatifs += 1;
      if (s === 'neutre') map[tKey].neutres += 1;
      const criticite = normalizeCriticite(f.analyse_ia?.criticite);
      if (criticite) map[tKey].criticites[criticite] = (map[tKey].criticites[criticite] || 0) + 1;
      if (f.agence_nom) map[tKey].agences.add(f.agence_nom);
      if (f.commentaire && map[tKey].verbatims.length < 3) {
        map[tKey].verbatims.push(f.commentaire);
      }
    });

    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [feedbacks]);

  // ── Filtres actifs (l'agence fixée par le contexte de la page n'est pas un filtre retirable) ──
  const agenceFiltreActif = showAgenceSelector && selectedAgenceId !== 'all';
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (agenceFiltreActif) {
    activeFilters.push({
      key: 'agence',
      label: `Agence : ${agences.find((a) => a.id === selectedAgenceId)?.nom || 'Sélectionnée'}`,
      clear: () => setSelectedAgenceId('all'),
    });
  }
  if (filterSentiment !== 'all') {
    activeFilters.push({
      key: 'sentiment',
      label: `Ton : ${SENTIMENT_STYLE[filterSentiment]?.label || filterSentiment}`,
      clear: () => setFilterSentiment('all'),
    });
  }
  if (filterTheme !== 'all') {
    activeFilters.push({ key: 'theme', label: `Thème : ${filterTheme === 'non_categorise' ? 'Non catégorisé' : themeLabel(filterTheme)}`, clear: () => setFilterTheme('all') });
  }
  if (filterPeriode !== 'all') {
    const labels: Record<string, string> = { today: "Aujourd'hui", '7': '7 derniers jours', '30': '30 derniers jours' };
    activeFilters.push({ key: 'periode', label: `Période : ${labels[filterPeriode] || filterPeriode}`, clear: () => setFilterPeriode('all') });
  }
  if (filterNote !== 'all') activeFilters.push({ key: 'note', label: `Note : ${filterNote}/5`, clear: () => setFilterNote('all') });
  if (filterCriticite !== 'all') {
    const labels: Record<string, string> = { critique: 'Critique', elevee: 'Élevée', moyenne: 'Moyenne', faible: 'Faible', non_evaluee: 'Non évaluée' };
    activeFilters.push({ key: 'criticite', label: `Gravité : ${labels[filterCriticite] || filterCriticite}`, clear: () => setFilterCriticite('all') });
  }
  if (search.trim()) {
    activeFilters.push({ key: 'search', label: `Recherche : « ${search.trim()} »`, clear: () => setSearch('') });
  }
  const resetFilters = () => {
    setSelectedAgenceId(agenceId || 'all');
    setFilterSentiment('all');
    setFilterTheme('all');
    setFilterNote('all');
    setFilterCriticite('all');
    setFilterPeriode('all');
    setSearch('');
    setActiveTab('tous');
  };

  // ── Pagination côté client sur la liste déjà filtrée (aucun rechargement API entre les pages) ──
  const totalPages = Math.max(1, Math.ceil(tabFeedbacks.length / PAGE_SIZE));
  const pageCourante = Math.min(page, totalPages - 1);
  const pageFeedbacks = tabFeedbacks.slice(pageCourante * PAGE_SIZE, (pageCourante + 1) * PAGE_SIZE);

  // Retour à la première page quand l'onglet, un filtre ou le nombre de feedbacks change (pas quand un feedback est simplement mis à jour depuis la modale).
  useEffect(() => {
    setPage(0);
  }, [activeTab, selectedAgenceId, filterSentiment, filterTheme, filterNote, filterCriticite, filterPeriode, search]);

  const tabsConfig = [
    { id: 'tous', label: 'Tous les avis', icon: <MessageSquareIcon size={16} />, badge: loading ? undefined : feedbackTotal },
    {
      id: 'a_traiter',
      label: 'À traiter',
      icon: <ClockIcon size={16} />,
      badge: loading ? undefined : `${aTraiterCount}${feedbacks.length < feedbackTotal ? '*' : ''}`,
      badgeColor: aTraiterCount > 0 ? ('red' as const) : ('default' as const),
    },
    {
      id: 'critiques',
      label: 'À surveiller',
      icon: <AlertTriangleIcon size={16} />,
      badge: loading ? undefined : `${critiquesCount}${feedbacks.length < feedbackTotal ? '*' : ''}`,
      badgeColor: critiquesCount > 0 ? ('red' as const) : ('default' as const),
    },
    { id: 'thematiques', label: 'Thèmes', icon: <TagIcon size={16} />, badge: loading ? undefined : themesAggregated.length },
  ];
  const aucunFeedbackDansPerimetre = feedbacks.length === 0 && feedbackTotal === 0;
  const filtresSansAgence = activeFilters.some((filter) => filter.key !== 'agence') || activeTab !== 'tous';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 600 }}>
          {toast}
        </div>
      )}

      {/* Contexte d'agence et vues : le périmètre précède les résultats. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        {!showAgenceSelector && currentUser?.role === 'agency_manager' && (
          <div aria-label="Périmètre de l’agence" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#334155', fontSize: '0.84rem', fontWeight: 700, padding: '8px 12px' }}>
            <StoreIcon size={16} color="#3C7730" />
            {currentUser.agence_nom || 'Mon agence'}
          </div>
        )}

        <TabsNavigation
          tabs={tabsConfig}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as FeedbackTab)}
          style={{ marginBottom: 0, flex: '1 1 auto' }}
        />
      </div>
      {!loading && !loadError && (
        <p role="status" style={{ margin: '-12px 0 0', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
          Les compteurs « À traiter » et « À surveiller » (gravité élevée ou critique, ton négatif ou avis contradictoire) portent sur {feedbacks.length} avis chargés sur {feedbackTotal} au total{feedbacks.length < feedbackTotal ? ' (* couverture partielle)' : ''}. Recherche et filtres s’appliquent à ces éléments chargés.
        </p>
      )}

      {/* ── ONGLET 1, 2, 3 : VUES TABLEAU DE FEEDBACKS ── */}
      {activeTab !== 'thematiques' && (
        <section aria-labelledby="feedbacks-liste" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div id="feedbacks-liste"><SectionHeading>Liste des avis</SectionHeading></div>
          {/* Barre de Recherche et Filtres */}
          <div className="feedbacks-toolbar">
            <div className="feedbacks-search">
              <SearchIcon size={16} color="#94A3B8" />
              <input
                type="text"
                placeholder="Rechercher parmi les avis chargés..."
                aria-label="Rechercher dans les commentaires chargés"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  border: 'none', width: '100%', minWidth: 0, fontSize: '0.84rem', fontFamily: 'inherit', color: '#0F172A',
                }}
              />
            </div>
            {showAgenceSelector && (
              <select className="feedbacks-agency-select" value={selectedAgenceId} onChange={(e) => setSelectedAgenceId(e.target.value)} aria-label="Filtrer par agence">
                <option value="all">Toutes les agences</option>
                {agences.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
              </select>
            )}
            <details
              className="feedbacks-filter-details"
              open={filtersOpen}
              onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
            >
              <summary><FilterIcon size={15} /> Filtres {activeFilters.length > 0 ? `(${activeFilters.length})` : ''}</summary>
              <div className="feedbacks-filter-controls">
              <label className="feedbacks-select-label">Période
                <select value={filterPeriode} onChange={(e) => setFilterPeriode(e.target.value)} aria-label="Filtrer par période">
                  <option value="all">Toutes les dates</option><option value="today">Aujourd'hui</option><option value="7">7 derniers jours</option><option value="30">30 derniers jours</option>
                </select>
              </label>
              <label className="feedbacks-select-label">Note
                <select value={filterNote} onChange={(e) => setFilterNote(e.target.value)} aria-label="Filtrer par note">
                  <option value="all">Toutes les notes</option>{[1, 2, 3, 4, 5].map((note) => <option key={note} value={note}>{note}/5</option>)}
                </select>
              </label>
              <select
                value={filterSentiment}
                onChange={(e) => setFilterSentiment(e.target.value)}
                aria-label="Filtrer par ton"
              >
                <option value="all">Tous les tons</option>
                <option value="positif">Positif</option>
                <option value="neutre">Neutre</option>
                <option value="negatif">Négatif</option>
              </select>
              <select value={filterCriticite} onChange={(e) => setFilterCriticite(e.target.value)} aria-label="Filtrer par gravité">
                <option value="all">Toutes gravités</option><option value="critique">Critique</option><option value="elevee">Élevée</option><option value="moyenne">Moyenne</option><option value="faible">Faible</option><option value="non_evaluee">Non évaluée</option>
              </select>
              <select
                value={filterTheme}
                onChange={(e) => setFilterTheme(e.target.value)}
                aria-label="Filtrer par thème"
              >
                <option value="all">Tous thèmes</option>
                {themesDisponibles.map((t) => (
                  <option key={t} value={t}>{t === 'non_categorise' ? 'Non catégorisé' : themeLabel(t)}</option>
                ))}
              </select>
              </div>
            </details>
          </div>

          {/* Récapitulatif des filtres actifs */}
          {activeFilters.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} aria-label="Filtres actifs">
              {activeFilters.map((f) => (
                <span
                  key={f.key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--color-active-item)',
                    color: 'var(--color-primary-dark)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '4px 6px 4px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                  }}
                >
                  {f.label}
                  <button
                    type="button"
                    onClick={f.clear}
                    aria-label={`Retirer le filtre ${f.label}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'inherit' }}
                  >
                    <XCloseIcon size={13} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={resetFilters}
                className="btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
              >
                Tout réinitialiser
              </button>
            </div>
          )}

          {/* Tableau des Feedbacks */}
          <div className="feedbacks-desktop-table"
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
                  <th scope="col" style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Date et agence</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Note et ton</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Commentaire du client</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Thème</th>
                  <th scope="col" style={{ textAlign: 'center', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Statut</th>
                  <th scope="col" style={{ textAlign: 'right', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [0, 1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} aria-busy="true" style={{ borderBottom: '1px solid #F1F4EE' }}>
                      <td colSpan={6} style={{ padding: '14px 16px' }}>
                        <SkeletonBlock height={40} radius="var(--radius-md)" />
                      </td>
                    </tr>
                  ))
                ) : loadError ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        illustration="no-data"
                        title="Impossible de charger les avis"
                        message="Une erreur est survenue lors du chargement. Vérifiez votre connexion puis réessayez."
                        action={{ label: 'Réessayer', onClick: () => setReloadToken((token) => token + 1) }}
                      />
                    </td>
                  </tr>
                ) : tabFeedbacks.length > 0 ? (
                  pageFeedbacks.map((f) => {
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
                            {formatDate(f.date_soumission)}
                          </div>
                        </td>

                        {/* Note & Sentiment */}
                        <td style={{ padding: '14px 16px', minWidth: '150px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
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
                              {f.analyse_ia ? sentMeta.label : 'Non analysé'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '7px' }}>
                            {f.analyse_ia?.criticite ? (
                              <span
                                aria-label={`Gravité ${(GRAVITE_LABELS[f.analyse_ia.criticite as CriticiteType] ?? f.analyse_ia.criticite).toLowerCase()}`}
                                style={{
                                  background: CRITICITE_STYLE[f.analyse_ia.criticite]?.bg || '#F1F5F9',
                                  color: CRITICITE_STYLE[f.analyse_ia.criticite]?.text || '#475569',
                                  padding: f.analyse_ia.criticite === 'critique' || f.analyse_ia.criticite === 'elevee' ? '3px 8px' : '1px 0',
                                  borderRadius: '6px',
                                  fontSize: f.analyse_ia.criticite === 'critique' || f.analyse_ia.criticite === 'elevee' ? '0.72rem' : '0.70rem',
                                  fontWeight: 800,
                                  border: f.analyse_ia.criticite === 'critique' ? '1px solid #DC2626' : '1px solid transparent',
                                }}
                              >
                                {f.analyse_ia.criticite === 'critique' ? 'CRITIQUE' : f.analyse_ia.criticite === 'elevee' ? 'ÉLEVÉE' : `Gravité ${(GRAVITE_LABELS[f.analyse_ia.criticite as CriticiteType] ?? f.analyse_ia.criticite).toLowerCase()}`}
                              </span>
                            ) : <span style={{ fontSize: '0.70rem', color: '#64748B' }}>{f.analyse_ia ? 'Gravité non évaluée' : 'Non analysé'}</span>}
                            {f.analyse_ia?.discordance_detectee && <span style={{ color: '#9A3412', fontSize: '0.70rem', fontWeight: 800 }}>Avis contradictoire</span>}
                          </div>
                        </td>

                        {/* Verbatim */}
                        <td style={{ padding: '14px 16px', maxWidth: '340px' }}>
                          <div style={{ color: '#334155', lineHeight: 1.4, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {f.commentaire || 'Pas de commentaire écrit.'}
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
                            {f.analyse_ia?.theme_principal ? themeLabel(f.analyse_ia.theme_principal) : 'Non catégorisé'}
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
                          {f.issue_id && <div style={{ marginTop: '6px', color: '#0369A1', fontSize: '0.70rem', fontWeight: 800 }}>Rattaché à un problème</div>}
                        </td>

                        {/* Action */}
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFeedbackForTreatment(f);
                            }}
                            className="btn-primary"
                            style={{ padding: '6px 12px', fontSize: '0.76rem', borderRadius: '10px' }}
                          >
                            Consulter
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6}>
                      {filtresSansAgence && !aucunFeedbackDansPerimetre ? (
                        <EmptyState
                          illustration="no-feedback"
                          title="Aucun avis ne correspond à ces critères."
                          message={`Les critères ont été appliqués aux ${feedbacks.length} avis chargés sur ${feedbackTotal}.`}
                          action={{ label: 'Réinitialiser les filtres', onClick: resetFilters }}
                        />
                      ) : (
                        <div className="saas-card saas-card--success">
                          <EmptyState
                            illustration="no-feedback"
                            title="Aucun avis dans ce périmètre"
                            message="Aucun avis client n’a encore été reçu pour l’agence ou le périmètre sélectionné."
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!loading && !loadError && tabFeedbacks.length > 0 && (
            <div className="feedbacks-mobile-list" aria-label="Avis clients">
              {pageFeedbacks.map((f) => {
                const sentiment = normalizeSentiment(f.analyse_ia?.sentiment);
                const sentimentMeta = SENTIMENT_STYLE[sentiment];
                const criticite = normalizeCriticite(f.analyse_ia?.criticite);
                const statut = STATUT_BADGES[(f.statut_traitement || 'nouveau') as StatutTraitement] || STATUT_BADGES.nouveau;
                return (
                  <article key={f.id} className="feedbacks-mobile-card">
                    <div className="feedbacks-mobile-card-top">
                      <strong>★ {f.note}/5</strong>
                      <span>{f.analyse_ia ? (CRITICITE_STYLE[criticite] ? `${criticite === 'elevee' ? 'Élevée' : criticite.charAt(0).toUpperCase() + criticite.slice(1)}` : 'Gravité non évaluée') : 'Non analysé'}</span>
                      <span>{sentimentMeta?.label || (f.analyse_ia ? 'Ton non évalué' : 'Non analysé')}</span>
                    </div>
                    <p>{f.commentaire || 'Pas de commentaire écrit.'}</p>
                    <div className="feedbacks-mobile-meta">
                      {showAgenceSelector && <span>{f.agence_nom || 'Agence'}</span>}
                      <time dateTime={f.date_soumission}>{formatDate(f.date_soumission)}</time>
                      <span className="feedbacks-mobile-status" style={{ background: statut.bg, color: statut.text }}>{statut.label}</span>
                      {f.issue_id && <span>Rattaché à un problème</span>}
                    </div>
                    <button type="button" className="btn-primary" onClick={(e) => { e.stopPropagation(); setSelectedFeedbackForTreatment(f); }}>Consulter</button>
                  </article>
                );
              })}
            </div>
          )}
          {!loading && loadError && <div className="feedbacks-mobile-empty"><EmptyState illustration="no-data" title="Impossible de charger les avis" message="Une erreur est survenue lors du chargement. Vérifiez votre connexion puis réessayez." action={{ label: 'Réessayer', onClick: () => setReloadToken((token) => token + 1) }} /></div>}
          {!loading && !loadError && tabFeedbacks.length === 0 && <div className="feedbacks-mobile-empty"><EmptyState illustration="no-feedback" title={filtresSansAgence && !aucunFeedbackDansPerimetre ? 'Aucun avis ne correspond à ces critères.' : 'Aucun avis dans ce périmètre'} message={filtresSansAgence && !aucunFeedbackDansPerimetre ? `Les critères ont été appliqués aux ${feedbacks.length} avis chargés sur ${feedbackTotal}.` : 'Aucun avis disponible dans ce périmètre.'} action={filtresSansAgence && !aucunFeedbackDansPerimetre ? { label: 'Réinitialiser les filtres', onClick: resetFilters } : undefined} /></div>}
          {loading && <div className="feedbacks-mobile-empty" role="status" aria-busy="true">Chargement des avis…</div>}

          {/* Pagination côté client */}
          {!loading && tabFeedbacks.length > 0 && (
            <nav aria-label="Pagination des avis" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                {pageCourante * PAGE_SIZE + 1}–{Math.min((pageCourante + 1) * PAGE_SIZE, tabFeedbacks.length)} affichés sur {tabFeedbacks.length} correspondants · {feedbacks.length} chargés sur {feedbackTotal} au total
              </span>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setPage(pageCourante - 1)}
                    disabled={pageCourante === 0}
                    className="btn-secondary"
                    style={{ padding: '6px 14px', fontSize: '0.8rem', cursor: pageCourante === 0 ? 'default' : 'pointer', opacity: pageCourante === 0 ? 0.45 : 1 }}
                  >
                    Précédent
                  </button>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
                    Page {pageCourante + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(pageCourante + 1)}
                    disabled={pageCourante >= totalPages - 1}
                    className="btn-secondary"
                    style={{ padding: '6px 14px', fontSize: '0.8rem', cursor: pageCourante >= totalPages - 1 ? 'default' : 'pointer', opacity: pageCourante >= totalPages - 1 ? 0.45 : 1 }}
                  >
                    Suivant
                  </button>
                </div>
              )}
              {feedbacks.length < feedbackTotal && (
                <button type="button" onClick={loadMoreFeedbacks} disabled={loadingMore} className="btn-secondary">
                  {loadingMore ? 'Chargement…' : 'Charger plus d’avis'}
                </button>
              )}
            </nav>
          )}
        </section>
      )}

      {/* ── ONGLET 4 : THÉMATIQUES (thèmes réellement présents) ── */}
      {activeTab === 'thematiques' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div id="feedbacks-themes"><SectionHeading>Thèmes des avis</SectionHeading></div>
        {loading && (
          <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} height={150} radius="var(--radius-xl)" />
            ))}
          </div>
        )}
        {!loading && loadError && <EmptyState illustration="no-data" title="Impossible de charger les avis" message="Une erreur est survenue lors du chargement des thèmes." action={{ label: 'Réessayer', onClick: () => setReloadToken((token) => token + 1) }} />}
        {!loading && !loadError && themesAggregated.length === 0 && (
          <EmptyState illustration="no-data" title="Aucun thème disponible" message={feedbackTotal === 0 ? 'Aucun avis dans ce périmètre.' : 'Aucun thème analysé parmi les avis chargés.'} />
        )}
        {!loading && !loadError && feedbackTotal > 0 && (
          <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.76rem' }}>Analyse basée sur les {feedbacks.length} avis chargés sur {feedbackTotal} au total.</p>
        )}
        {!loadError && <div
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
                    {thm.positifs} positifs
                  </span>
                  <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '2px 6px', borderRadius: '6px', fontSize: '0.70rem', fontWeight: 700 }}>
                    {thm.negatifs} négatifs
                  </span>
                  <span style={{ color: '#64748B', fontSize: '0.70rem', marginLeft: 'auto', alignSelf: 'center' }}>
                    📍 {thm.agences.size} agences concernées
                  </span>
                </div>
                <p style={{ margin: '0 0 10px', color: '#475569', fontSize: '0.76rem' }}>
                  Ton dominant : {sentimentDominant(thm.positifs, thm.negatifs, thm.neutres)}
                  {Object.keys(thm.criticites).length > 0 ? ` · Gravité la plus fréquente : ${{ critique: 'critique', elevee: 'élevée', moyenne: 'moyenne', faible: 'faible' }[Object.entries(thm.criticites).sort((a, b) => b[1] - a[1])[0][0]] || Object.entries(thm.criticites).sort((a, b) => b[1] - a[1])[0][0]}` : ' · Aucune gravité disponible'}
                </p>

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
                className="btn-primary"
                style={{ padding: '8px', fontSize: '0.76rem', borderRadius: '10px', width: '100%', justifyContent: 'center' }}
              >
                Voir les {thm.count} avis chargés de ce thème →
              </button>
            </div>
          ))}
        </div>}
        {!loading && !loadError && feedbacks.length < feedbackTotal && (
          <button type="button" onClick={loadMoreFeedbacks} disabled={loadingMore} className="btn-secondary" style={{ alignSelf: 'flex-start' }}>
            {loadingMore ? 'Chargement…' : 'Charger plus d’avis pour compléter l’analyse'}
          </button>
        )}
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

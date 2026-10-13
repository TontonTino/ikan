import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { feedbacksApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Feedback, Agence, StatutTraitement } from '../../types';
import FeedbackTreatmentModal from '../../components/feedbacks/FeedbackTreatmentModal';
import { AvisCarteMobile, SignauxAvis, STATUT_BADGES, formatDateAvis } from '../../components/feedbacks/avisAffichage';
import TabsNavigation from '../../components/ui/TabsNavigation';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import { MessageSquareIcon, SearchIcon, FilterIcon, StoreIcon, AlertTriangleIcon, ClockIcon, TagIcon, XCloseIcon } from '../../components/common/Icons';
import { themeLabel } from '../../utils/themeLabels';
import { normalizeCriticite, normalizeSentiment } from '../../utils/triageAvis';
import { useValeurDifferee } from '../../utils/debounce';
import {
  FILTRES_INITIAUX, LONGUEUR_MAX_RECHERCHE, TAILLE_PAGE, filtresActifs as listerFiltresActifs, libelleTotal, nombrePages,
  parametresApi, rechercheNormalisee, reduireFiltres, type FiltresAvis, type OngletAvis,
} from './avisFiltres';
import EtatListeAvis from './EtatListeAvis';
import './FeedbacksPage.css';

// Les thèmes (onglet « Thèmes ») sont agrégés sur les avis les plus récents correspondant aux filtres, au plus ECHANTILLON_THEMES.
const ECHANTILLON_THEMES = 200;

const TABS_VALIDES: readonly OngletAvis[] = ['tous', 'a_traiter', 'critiques', 'thematiques'];

// Contexte de navigation (liens depuis les tableaux de bord) : valeurs reconnues, tout le reste est ignoré.
const PERIODES_URL = ['7', '30', '90', '365'] as const;
const periodeDepuisUrl = (valeur: string | null) => (valeur && (PERIODES_URL as readonly string[]).includes(valeur) ? valeur : 'all');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifiantDepuisUrl = (valeur: string | null) => (valeur && UUID_RE.test(valeur) ? valeur : null);
const ongletDepuisUrl = (valeur: string | null): OngletAvis => (TABS_VALIDES.includes(valeur as OngletAvis) ? (valeur as OngletAvis) : 'tous');

const sentimentDominant = (positifs: number, negatifs: number, neutres: number) => {
  const sentiments = [['positif', positifs], ['négatif', negatifs], ['neutre', neutres]] as const;
  const maximum = Math.max(positifs, negatifs, neutres);
  if (maximum === 0) return 'non évalué';
  const dominants = sentiments.filter(([, count]) => count === maximum).map(([label]) => label);
  return dominants.length > 1 ? `à égalité (${dominants.join(', ')})` : dominants[0];
};

interface FeedbacksPageProps {
  /**
   * Agence fixe (page agence unifiée, onglet Feedbacks) : quand fourni, le sélecteur d'agence est masqué et la liste est
   * filtrée côté serveur sur cette seule agence.
   */
  agenceId?: string;
}

export default function FeedbacksPage({ agenceId }: FeedbacksPageProps = {}) {
  const [searchParams] = useSearchParams();
  const currentUser = useAuthStore((s) => s.user);
  const isCXOrAdmin = currentUser?.role === 'cx_manager' || currentUser?.role === 'admin';
  // Le sélecteur d'agence n'a de sens que si l'agence n'est pas déjà fixée par le contexte de la page.
  const showAgenceSelector = isCXOrAdmin && !agenceId;

  // Filtres, recherche, onglet et page : un seul état. Tout changement (sauf de page) revient à la page 1.
  const [filtres, dispatch] = useReducer(reduireFiltres, undefined, (): FiltresAvis => ({
    ...FILTRES_INITIAUX,
    onglet: ongletDepuisUrl(searchParams.get('tab')),
    theme: searchParams.get('theme') || 'all',
    periode: periodeDepuisUrl(searchParams.get('jours')),
    agenceId: agenceId || (isCXOrAdmin ? identifiantDepuisUrl(searchParams.get('agence')) : null) || 'all',
  }));
  const [saisie, setSaisie] = useState('');
  const rechercheDifferee = useValeurDifferee(saisie);

  const [avis, setAvis] = useState<Feedback[]>([]);
  const [total, setTotal] = useState(0);
  const [compteurs, setCompteurs] = useState<{ tous: number; a_traiter: number; critiques: number } | null>(null);
  const [echantillon, setEchantillon] = useState<Feedback[]>([]);
  const [themesDisponibles, setThemesDisponibles] = useState<string[]>([]);
  const [agences, setAgences] = useState<Agence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [themeCatalogError, setThemeCatalogError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [toast, setToast] = useState('');
  const [selectedFeedbackForTreatment, setSelectedFeedbackForTreatment] = useState<Feedback | null>(null);
  const avisModifie = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 700px)').matches);

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 700px)');
    const syncFilterPanel = () => setFiltersOpen(!mobileQuery.matches);
    mobileQuery.addEventListener('change', syncFilterPanel);
    return () => mobileQuery.removeEventListener('change', syncFilterPanel);
  }, []);

  // La recherche part au serveur après une courte pause dans la frappe (300 ms), pas à chaque lettre.
  useEffect(() => {
    dispatch({ type: 'definir', champ: 'recherche', valeur: rechercheNormalisee(rechercheDifferee) });
  }, [rechercheDifferee]);

  // Navigation par lien (?tab, ?theme, ?jours, ?agence) : applique le contexte demandé.
  useEffect(() => {
    dispatch({ type: 'definir', champ: 'onglet', valeur: ongletDepuisUrl(searchParams.get('tab')) });
    dispatch({ type: 'definir', champ: 'theme', valeur: searchParams.get('theme') || 'all' });
    dispatch({ type: 'definir', champ: 'periode', valeur: periodeDepuisUrl(searchParams.get('jours')) });
    const agenceUrl = identifiantDepuisUrl(searchParams.get('agence'));
    if (isCXOrAdmin && !agenceId && agenceUrl) dispatch({ type: 'definir', champ: 'agenceId', valeur: agenceUrl });
  }, [searchParams]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ── Liste de la page courante (serveur : filtres, recherche, onglet, pagination) ──
  const paramsListe = useMemo(() => parametresApi(filtres, { agenceFixe: agenceId, onglet: filtres.onglet === 'thematiques' ? 'tous' : filtres.onglet }), [filtres, agenceId]);
  const cleListe = JSON.stringify(paramsListe);

  useEffect(() => {
    if (filtres.onglet === 'thematiques') return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    feedbacksApi.list(paramsListe)
      .then((res) => {
        if (cancelled) return;
        const liste = (res?.data || []) as Feedback[];
        const entete = Number(res?.headers?.['x-total-count']);
        setAvis(liste);
        setTotal(Number.isFinite(entete) ? entete : liste.length);
      })
      .catch((err) => {
        console.error('Erreur chargement:', err);
        if (cancelled) return;
        setAvis([]);
        setTotal(0);
        setLoadError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cleListe, reloadToken]);

  // ── Compteurs des onglets : mêmes filtres, hors onglet et hors page, une requête légère chacun ──
  const cleCompteurs = JSON.stringify(parametresApi(filtres, { agenceFixe: agenceId, onglet: 'tous', limit: 1, offset: 0 }));
  useEffect(() => {
    let cancelled = false;
    const compter = (onglet: OngletAvis) => feedbacksApi.list(parametresApi(filtres, { agenceFixe: agenceId, onglet, limit: 1, offset: 0 }))
      .then((res) => Number(res?.headers?.['x-total-count']));
    Promise.all([compter('tous'), compter('a_traiter'), compter('critiques')])
      .then(([tous, a_traiter, critiques]) => { if (!cancelled) setCompteurs({ tous, a_traiter, critiques }); })
      .catch(() => { if (!cancelled) setCompteurs(null); });
    return () => { cancelled = true; };
  }, [cleCompteurs, reloadToken]);

  // ── Onglet « Thèmes » : échantillon des avis les plus récents correspondant aux filtres ──
  useEffect(() => {
    if (filtres.onglet !== 'thematiques') return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    feedbacksApi.list(parametresApi(filtres, { agenceFixe: agenceId, onglet: 'tous', limit: ECHANTILLON_THEMES, offset: 0 }))
      .then((res) => {
        if (cancelled) return;
        const liste = (res?.data || []) as Feedback[];
        const entete = Number(res?.headers?.['x-total-count']);
        setEchantillon(liste);
        setTotal(Number.isFinite(entete) ? entete : liste.length);
      })
      .catch((err) => {
        console.error('Erreur chargement des thèmes:', err);
        if (cancelled) return;
        setEchantillon([]);
        setLoadError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filtres.onglet, cleCompteurs, reloadToken]);

  // ── Catalogue des thèmes et liste des agences ──
  useEffect(() => {
    let cancelled = false;
    setThemeCatalogError(false);
    const agenceFiltre = agenceId || (filtres.agenceId !== 'all' ? filtres.agenceId : undefined);
    feedbacksApi.themes(agenceFiltre ? { agence_id: agenceFiltre } : undefined)
      .then((r) => { if (!cancelled) setThemesDisponibles((r?.data || []) as string[]); })
      .catch((err) => {
        console.error('Erreur chargement des thèmes:', err);
        if (!cancelled) { setThemesDisponibles([]); setThemeCatalogError(true); }
      });
    return () => { cancelled = true; };
  }, [agenceId, filtres.agenceId, reloadToken]);

  useEffect(() => {
    if (!showAgenceSelector) return;
    agencesApi.list().then((r) => { if (r?.data) setAgences(r.data); }).catch((err) => {
      // Une indisponibilité du sélecteur d'agence ne doit pas masquer la liste déjà chargée.
      console.error('Erreur chargement des agences:', err);
    });
  }, [showAgenceSelector]);

  // Avis ciblé (?avis=<id>) : ouvert une seule fois par identifiant, d'abord depuis la page chargée, sinon directement
  // auprès du serveur (qui impose le rôle et le périmètre). Identifiant invalide ou hors périmètre : message, jamais d'erreur bloquante.
  const avisCible = identifiantDepuisUrl(searchParams.get('avis'));
  const avisOuvert = useRef<string | null>(null);
  useEffect(() => {
    if (!avisCible || loading || avisOuvert.current === avisCible) return;
    avisOuvert.current = avisCible;
    const dansListe = avis.find((f) => f.id === avisCible);
    if (dansListe) { setSelectedFeedbackForTreatment(dansListe); return; }
    feedbacksApi.get(avisCible)
      .then((r) => setSelectedFeedbackForTreatment(r.data as Feedback))
      .catch(() => showToast('Avis introuvable ou hors de votre périmètre'));
  }, [avisCible, loading, avis]);

  const handleUpdateSingleFeedback = (updated: Feedback) => {
    avisModifie.current = true;
    setAvis((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    if (selectedFeedbackForTreatment?.id === updated.id) setSelectedFeedbackForTreatment(updated);
  };

  const fermerModale = () => {
    setSelectedFeedbackForTreatment(null);
    // Un avis traité peut ne plus correspondre à l'onglet ou aux compteurs : on relit le serveur.
    if (avisModifie.current) { avisModifie.current = false; setReloadToken((t) => t + 1); }
  };

  // Thèmes réellement présents dans l'échantillon (catégories libres par agence, plus les anciennes clés IA).
  const themesAggregated = useMemo(() => {
    const map: Record<string, { theme: string; label: string; count: number; positifs: number; negatifs: number; neutres: number; criticites: Record<string, number>; agences: Set<string>; verbatims: string[] }> = {};
    echantillon.forEach((f) => {
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
      if (f.commentaire && map[tKey].verbatims.length < 3) map[tKey].verbatims.push(f.commentaire);
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [echantillon]);

  // ── Filtres actifs ──
  const activeFilters = listerFiltresActifs(filtres, {
    nomAgence: (id) => agences.find((a) => a.id === id)?.nom,
    libelleTheme: themeLabel,
    agenceFixe: Boolean(agenceId) || !showAgenceSelector,
  });
  const retirerFiltre = (cle: (typeof activeFilters)[number]['cle']) => {
    if (cle === 'recherche') setSaisie('');
    dispatch({ type: 'definir', champ: cle, valeur: cle === 'recherche' ? '' : 'all' });
  };
  const reinitialiser = () => {
    setSaisie('');
    dispatch({ type: 'reinitialiser', agenceId });
  };
  const filtresOuOnglet = activeFilters.length > 0 || filtres.onglet !== 'tous';

  const pages = nombrePages(total);
  const pageCourante = Math.min(filtres.page, pages - 1);
  const debutPage = total === 0 ? 0 : pageCourante * TAILLE_PAGE + 1;
  const finPage = Math.min((pageCourante + 1) * TAILLE_PAGE, total);

  const tabsConfig = [
    { id: 'tous', label: 'Tous les avis', icon: <MessageSquareIcon size={16} />, badge: compteurs ? compteurs.tous : undefined },
    { id: 'a_traiter', label: 'À traiter', icon: <ClockIcon size={16} />, badge: compteurs ? compteurs.a_traiter : undefined, badgeColor: compteurs && compteurs.a_traiter > 0 ? ('red' as const) : ('default' as const) },
    { id: 'critiques', label: 'À surveiller', icon: <AlertTriangleIcon size={16} />, badge: compteurs ? compteurs.critiques : undefined, badgeColor: compteurs && compteurs.critiques > 0 ? ('red' as const) : ('default' as const) },
    { id: 'thematiques', label: 'Thèmes', icon: <TagIcon size={16} />, badge: filtres.onglet === 'thematiques' && !loading ? themesAggregated.length : undefined },
  ];

  const th = { textAlign: 'left' as const, padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' as const };

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
        <TabsNavigation tabs={tabsConfig} activeTab={filtres.onglet} onChange={(id) => dispatch({ type: 'definir', champ: 'onglet', valeur: id })} style={{ marginBottom: 0, flex: '1 1 auto' }} />
      </div>
      <p style={{ margin: '-12px 0 0', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
        « À traiter » : avis non résolus ou avec une demande de rappel en attente. « À surveiller » : avis avec au moins un signal (note de 2 ou moins, ton négatif, gravité élevée ou critique, ou avis contradictoire), chacun compté une seule fois.
      </p>

      {/* ── ONGLETS 1, 2, 3 : LISTE DES AVIS ── */}
      {filtres.onglet !== 'thematiques' && (
        <section aria-labelledby="feedbacks-liste" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div id="feedbacks-liste"><SectionHeading>Liste des avis</SectionHeading></div>
          <div className="feedbacks-toolbar">
            <div className="feedbacks-search">
              <SearchIcon size={16} color="#94A3B8" />
              <input
                type="search"
                placeholder="Rechercher dans le texte des avis…"
                aria-label="Rechercher dans le texte des avis"
                maxLength={LONGUEUR_MAX_RECHERCHE}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                style={{ border: 'none', width: '100%', minWidth: 0, fontSize: '0.84rem', fontFamily: 'inherit', color: '#0F172A' }}
              />
            </div>
            {showAgenceSelector && (
              <select className="feedbacks-agency-select" value={filtres.agenceId} onChange={(e) => dispatch({ type: 'definir', champ: 'agenceId', valeur: e.target.value })} aria-label="Filtrer par agence">
                <option value="all">Toutes les agences</option>
                {agences.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
              </select>
            )}
            <details className="feedbacks-filter-details" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
              <summary><FilterIcon size={15} /> Filtres {activeFilters.length > 0 ? `(${activeFilters.length})` : ''}</summary>
              <div className="feedbacks-filter-controls">
                <label className="feedbacks-select-label">Période
                  <select value={filtres.periode} onChange={(e) => dispatch({ type: 'definir', champ: 'periode', valeur: e.target.value })} aria-label="Filtrer par période">
                    <option value="all">Toutes les dates</option><option value="today">Aujourd'hui</option><option value="7">7 derniers jours</option><option value="30">30 derniers jours</option><option value="90">90 derniers jours</option><option value="365">12 derniers mois</option>
                  </select>
                </label>
                <label className="feedbacks-select-label">Note
                  <select value={filtres.note} onChange={(e) => dispatch({ type: 'definir', champ: 'note', valeur: e.target.value })} aria-label="Filtrer par note">
                    <option value="all">Toutes les notes</option>{[1, 2, 3, 4, 5].map((note) => <option key={note} value={note}>{note}/5</option>)}
                  </select>
                </label>
                <select value={filtres.sentiment} onChange={(e) => dispatch({ type: 'definir', champ: 'sentiment', valeur: e.target.value })} aria-label="Filtrer par ton">
                  <option value="all">Tous les tons</option><option value="positif">Positif</option><option value="neutre">Neutre</option><option value="negatif">Négatif</option>
                </select>
                <select value={filtres.criticite} onChange={(e) => dispatch({ type: 'definir', champ: 'criticite', valeur: e.target.value })} aria-label="Filtrer par gravité">
                  <option value="all">Toutes gravités</option><option value="critique">Critique</option><option value="elevee">Élevée</option><option value="moyenne">Moyenne</option><option value="faible">Faible</option><option value="non_evaluee">Non évaluée</option>
                </select>
                <select value={filtres.theme} onChange={(e) => dispatch({ type: 'definir', champ: 'theme', valeur: e.target.value })} aria-label="Filtrer par thème">
                  <option value="all">Tous thèmes</option>
                  {filtres.theme !== 'all' && !themesDisponibles.includes(filtres.theme) && (
                    <option value={filtres.theme}>{filtres.theme === 'non_categorise' ? 'Non catégorisé' : themeLabel(filtres.theme)}</option>
                  )}
                  {themesDisponibles.map((t) => <option key={t} value={t}>{t === 'non_categorise' ? 'Non catégorisé' : themeLabel(t)}</option>)}
                </select>
              </div>
              {themeCatalogError && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px', color: 'var(--color-text-body)', fontSize: '0.82rem' }}>
                  <span>Impossible de charger la liste complète des thèmes.</span>
                  <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReloadToken((token) => token + 1)}>Réessayer</button>
                </div>
              )}
            </details>
          </div>

          {/* Total serveur : nombre d'avis correspondant aux filtres, pas seulement ceux de la page. */}
          {!loadError && (
            <p role="status" aria-live="polite" className="feedbacks-total" style={{ margin: 0, fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>
              {loading ? 'Recherche en cours…' : `${libelleTotal(total)}${filtresOuOnglet ? ' correspondant aux critères' : ''}`}
            </p>
          )}

          {/* Récapitulatif des filtres actifs */}
          {activeFilters.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} aria-label="Filtres actifs">
              {activeFilters.map((f) => (
                <span key={f.cle} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--color-active-item)', color: 'var(--color-primary-dark)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', padding: '4px 6px 4px 12px', fontSize: '0.76rem', fontWeight: 700 }}>
                  {f.libelle}
                  <button type="button" onClick={() => retirerFiltre(f.cle)} aria-label={`Retirer le filtre ${f.libelle}`} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'inherit' }}>
                    <XCloseIcon size={13} />
                  </button>
                </span>
              ))}
              <button type="button" onClick={reinitialiser} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.78rem' }}>Tout réinitialiser</button>
            </div>
          )}

          {/* Tableau (grands écrans) */}
          <div className="feedbacks-desktop-table" style={{ background: '#FFFFFF', borderRadius: '20px', border: '1px solid #E8ECE6', boxShadow: '0 2px 12px rgba(20, 60, 40, 0.03)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E8ECE6', background: '#F8FAFB' }}>
                  <th scope="col" style={th}>Date et agence</th>
                  <th scope="col" style={th}>Note et ton</th>
                  <th scope="col" style={th}>Commentaire du client</th>
                  <th scope="col" style={th}>Thème</th>
                  <th scope="col" style={{ ...th, textAlign: 'center' }}>Statut</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [0, 1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} aria-busy="true" style={{ borderBottom: '1px solid #F1F4EE' }}>
                      <td colSpan={6} style={{ padding: '14px 16px' }}><SkeletonBlock height={40} radius="var(--radius-md)" /></td>
                    </tr>
                  ))
                ) : avis.length > 0 ? (
                  avis.map((f) => {
                    const statMeta = STATUT_BADGES[(f.statut_traitement || 'nouveau') as StatutTraitement] || STATUT_BADGES.nouveau;
                    return (
                      <tr key={f.id} style={{ borderBottom: '1px solid #F1F4EE', cursor: 'pointer' }} onClick={() => setSelectedFeedbackForTreatment(f)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')} onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}>
                        <td style={{ padding: '14px 16px', minWidth: '140px' }}>
                          <div style={{ fontWeight: 700, color: '#02302D' }}>{f.agence_nom || 'Agence'}</div>
                          <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: '2px' }}>{formatDateAvis(f.date_soumission)}</div>
                        </td>
                        <td style={{ padding: '14px 16px', minWidth: '150px' }}><SignauxAvis feedback={f} /></td>
                        <td style={{ padding: '14px 16px', maxWidth: '340px' }}>
                          <div style={{ color: '#334155', lineHeight: 1.4, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {f.commentaire || 'Pas de commentaire écrit.'}
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px', minWidth: '140px' }}>
                          <span style={{ background: '#F1F5F9', color: '#475569', padding: '4px 10px', borderRadius: '8px', fontSize: '0.74rem', fontWeight: 700 }}>
                            {f.analyse_ia?.theme_principal ? themeLabel(f.analyse_ia.theme_principal) : 'Non catégorisé'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          <span style={{ background: statMeta.bg, color: statMeta.text, padding: '3px 10px', borderRadius: '9999px', fontSize: '0.74rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            {statMeta.icon}
                            {statMeta.label}
                          </span>
                          {f.issue_id && <div style={{ marginTop: '6px', color: '#0369A1', fontSize: '0.70rem', fontWeight: 800 }}>Rattaché à un problème</div>}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedFeedbackForTreatment(f); }} className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.76rem', borderRadius: '10px' }}>Consulter</button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <EtatListeAvis chargement={false} erreur={loadError} total={total} filtresActifs={filtresOuOnglet} onReessayer={() => setReloadToken((t) => t + 1)} onReinitialiser={reinitialiser} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Cartes (≤ 700 px) */}
          {!loading && !loadError && avis.length > 0 && (
            <div className="feedbacks-mobile-list" aria-label="Avis clients">
              {avis.map((f) => (
                <AvisCarteMobile key={f.id} feedback={f} afficherAgence={showAgenceSelector} onConsulter={() => setSelectedFeedbackForTreatment(f)} />
              ))}
            </div>
          )}
          {(loading || loadError || avis.length === 0) && (
            <div className="feedbacks-mobile-empty">
              <EtatListeAvis chargement={loading} erreur={loadError} total={total} filtresActifs={filtresOuOnglet} onReessayer={() => setReloadToken((t) => t + 1)} onReinitialiser={reinitialiser} />
            </div>
          )}

          {/* Pagination serveur */}
          {!loading && !loadError && total > 0 && (
            <nav aria-label="Pagination des avis" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{debutPage}–{finPage} sur {total}</span>
              {pages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button type="button" onClick={() => dispatch({ type: 'page', page: pageCourante - 1 })} disabled={pageCourante === 0} className="btn-secondary"
                    style={{ padding: '6px 14px', fontSize: '0.8rem', minHeight: 44, cursor: pageCourante === 0 ? 'default' : 'pointer', opacity: pageCourante === 0 ? 0.45 : 1 }}>Précédent</button>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-main)' }}>Page {pageCourante + 1} / {pages}</span>
                  <button type="button" onClick={() => dispatch({ type: 'page', page: pageCourante + 1 })} disabled={pageCourante >= pages - 1} className="btn-secondary"
                    style={{ padding: '6px 14px', fontSize: '0.8rem', minHeight: 44, cursor: pageCourante >= pages - 1 ? 'default' : 'pointer', opacity: pageCourante >= pages - 1 ? 0.45 : 1 }}>Suivant</button>
                </div>
              )}
            </nav>
          )}
        </section>
      )}

      {/* ── ONGLET 4 : THÈMES (échantillon des avis les plus récents) ── */}
      {filtres.onglet === 'thematiques' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div id="feedbacks-themes"><SectionHeading>Thèmes des avis</SectionHeading></div>
          {loading && (
            <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
              {[0, 1, 2].map((i) => <SkeletonBlock key={i} height={150} radius="var(--radius-xl)" />)}
            </div>
          )}
          {!loading && loadError && <EmptyState illustration="no-data" title="Impossible de charger les avis" message="Une erreur est survenue lors du chargement des thèmes." action={{ label: 'Réessayer', onClick: () => setReloadToken((token) => token + 1) }} />}
          {!loading && !loadError && themesAggregated.length === 0 && (
            <EmptyState illustration="no-data" title="Aucun thème disponible" message={total === 0 ? 'Aucun avis dans ce périmètre.' : 'Aucun thème analysé pour ces avis.'} />
          )}
          {!loading && !loadError && total > 0 && (
            <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.76rem' }}>
              {echantillon.length < total
                ? `Analyse basée sur les ${echantillon.length} avis les plus récents, sur ${total} correspondant aux filtres.`
                : `Analyse basée sur les ${total} avis correspondant aux filtres.`}
            </p>
          )}
          {!loadError && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
              {!loading && themesAggregated.map((thm) => (
                <div key={thm.theme} style={{ background: '#FFFFFF', borderRadius: '20px', padding: '20px 24px', border: '1px solid #E8ECE6', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '14px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#02302D' }}>{thm.label}</span>
                      <span style={{ background: '#02302D', color: '#FFFFFF', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 800 }}>{thm.count} avis</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <span style={{ background: '#EBF6ED', color: '#3C7730', padding: '2px 6px', borderRadius: '6px', fontSize: '0.70rem', fontWeight: 700 }}>{thm.positifs} positifs</span>
                      <span style={{ background: '#FEE2E2', color: '#B91C1C', padding: '2px 6px', borderRadius: '6px', fontSize: '0.70rem', fontWeight: 700 }}>{thm.negatifs} négatifs</span>
                      <span style={{ color: '#64748B', fontSize: '0.70rem', marginLeft: 'auto', alignSelf: 'center' }}>📍 {thm.agences.size} agences concernées</span>
                    </div>
                    <p style={{ margin: '0 0 10px', color: '#475569', fontSize: '0.76rem' }}>
                      Ton dominant : {sentimentDominant(thm.positifs, thm.negatifs, thm.neutres)}
                      {Object.keys(thm.criticites).length > 0 ? ` · Gravité la plus fréquente : ${{ critique: 'critique', elevee: 'élevée', moyenne: 'moyenne', faible: 'faible' }[Object.entries(thm.criticites).sort((a, b) => b[1] - a[1])[0][0]] || Object.entries(thm.criticites).sort((a, b) => b[1] - a[1])[0][0]}` : ' · Aucune gravité disponible'}
                    </p>
                    {thm.verbatims.length > 0 && (
                      <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '10px 12px', fontSize: '0.78rem', color: '#475569', fontStyle: 'italic', lineHeight: 1.4 }}>"{thm.verbatims[0]}"</div>
                    )}
                  </div>
                  <button type="button" onClick={() => { dispatch({ type: 'definir', champ: 'theme', valeur: thm.theme }); dispatch({ type: 'definir', champ: 'onglet', valeur: 'tous' }); }}
                    className="btn-primary" style={{ padding: '8px', fontSize: '0.76rem', borderRadius: '10px', width: '100%', justifyContent: 'center', minHeight: 44 }}>
                    Voir les avis de ce thème →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modale de traitement */}
      {selectedFeedbackForTreatment && (
        <FeedbackTreatmentModal
          feedback={selectedFeedbackForTreatment}
          isOpen={true}
          onClose={fermerModale}
          onUpdateFeedback={handleUpdateSingleFeedback}
          currentUserRole={currentUser?.role}
          currentUserName={currentUser ? `${currentUser.prenom} ${currentUser.nom}` : undefined}
        />
      )}
    </div>
  );
}

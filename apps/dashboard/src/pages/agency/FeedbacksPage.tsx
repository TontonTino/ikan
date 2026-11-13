import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { feedbacksApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Feedback, Agence, StatutTraitement, ThemesSynthese } from '../../types';
import FeedbackTreatmentModal from '../../components/feedbacks/FeedbackTreatmentModal';
import { AvisCarteMobile, SignauxAvis, STATUT_BADGES, formatDateAvis } from '../../components/feedbacks/avisAffichage';
import TabsNavigation from '../../components/ui/TabsNavigation';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import { MessageSquareIcon, SearchIcon, FilterIcon, StoreIcon, AlertTriangleIcon, ClockIcon, TagIcon, XCloseIcon } from '../../components/common/Icons';
import { themeLabel } from '../../utils/themeLabels';
import { ThemeAgences, ThemeTonGravite, ThemeVerbatim } from '../../components/feedbacks/ThemeInfos';
import { DEFINITION_NEGATIF, PartNegatifsTexte } from '../../utils/partNegatifs';
import { useValeurDifferee } from '../../utils/debounce';
import {
  FILTRES_INITIAUX, LONGUEUR_MAX_RECHERCHE, TAILLE_PAGE, filtresActifs as listerFiltresActifs, libelleTotal, nombrePages,
  parametresApi, parametresThemes, periodeDepuisUrl, rechercheNormalisee, reduireFiltres, type FiltresAvis, type OngletAvis,
} from './avisFiltres';
import EtatListeAvis from './EtatListeAvis';
import PageTitle from '../../components/ui/PageTitle';
import './FeedbacksPage.css';

const TABS_VALIDES: readonly OngletAvis[] = ['tous', 'a_traiter', 'critiques', 'thematiques'];

// Contexte de navigation (liens depuis les tableaux de bord) : valeurs reconnues, tout le reste est ignoré.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifiantDepuisUrl = (valeur: string | null) => (valeur && UUID_RE.test(valeur) ? valeur : null);
const ongletDepuisUrl = (valeur: string | null): OngletAvis => (TABS_VALIDES.includes(valeur as OngletAvis) ? (valeur as OngletAvis) : 'tous');

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
  // Le Responsable d'agence ne voit que son agence : la répéter à chaque ligne n'apporte rien. Le CX Manager garde date et agence.
  const afficherAgenceLigne = currentUser?.role !== 'agency_manager';

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
  const [synthese, setSynthese] = useState<ThemesSynthese | null>(null);
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

  // ── Onglet « Thèmes » : agrégat serveur sur TOUS les avis correspondant aux filtres (sauf le thème lui-même) ──
  const cleThemes = JSON.stringify(parametresThemes(filtres, { agenceFixe: agenceId }));
  useEffect(() => {
    if (filtres.onglet !== 'thematiques') return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    feedbacksApi.themesSynthese(parametresThemes(filtres, { agenceFixe: agenceId }))
      .then((res) => { if (!cancelled) setSynthese(res.data); })
      .catch((err) => {
        console.error('Erreur chargement des thèmes:', err);
        if (cancelled) return;
        setSynthese(null);
        setLoadError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filtres.onglet, cleThemes, reloadToken]);

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

  const themes = synthese?.themes ?? [];
  const totalThemes = synthese?.total_avis ?? 0;

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
    { id: 'thematiques', label: 'Thèmes', icon: <TagIcon size={16} />, badge: filtres.onglet === 'thematiques' && !loading && !loadError ? themes.length : undefined },
  ];

  const th = { textAlign: 'left' as const, padding: '12px 16px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', textTransform: 'uppercase' as const };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: 'var(--color-encre)', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 'var(--weight-semibold)' }}>
          {toast}
        </div>
      )}

      {/* Titre de page (absent quand la liste est intégrée à la page d'une agence : elle a déjà le sien). */}
      {!agenceId && (
        <PageTitle
          title={currentUser?.role === 'agency_manager' ? 'Avis clients' : 'Avis du réseau'}
          description={currentUser?.role === 'agency_manager' ? 'Les avis clients de votre agence.' : 'Les avis clients de toutes les agences de votre réseau.'}
        />
      )}

      {/* Contexte d'agence et vues : le périmètre précède les résultats. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        {!showAgenceSelector && currentUser?.role === 'agency_manager' && (
          <div aria-label="Périmètre de l’agence" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--color-encre)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', padding: '8px 12px' }}>
            <StoreIcon size={16} color="var(--color-bon-texte)" />
            {currentUser.agence_nom || 'Mon agence'}
          </div>
        )}
        <TabsNavigation tabs={tabsConfig} activeTab={filtres.onglet} onChange={(id) => dispatch({ type: 'definir', champ: 'onglet', valeur: id })} style={{ marginBottom: 0, flex: '1 1 auto' }} />
      </div>
      <p style={{ margin: '-12px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
        « À traiter » : avis non résolus ou avec une demande de rappel en attente. « À surveiller » : avis avec au moins un signal (note de 2 ou moins, ton négatif, gravité élevée ou critique, ou avis contradictoire), chacun compté une seule fois.
      </p>

      {/* ── ONGLETS 1, 2, 3 : LISTE DES AVIS ── */}
      {filtres.onglet !== 'thematiques' && (
        <section aria-labelledby="feedbacks-liste" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div id="feedbacks-liste"><SectionHeading>Liste des avis</SectionHeading></div>
          <div className="feedbacks-toolbar">
            <div className="feedbacks-search">
              <SearchIcon size={16} color="var(--color-text-2)" />
              <input
                type="search"
                placeholder="Rechercher dans le texte des avis…"
                aria-label="Rechercher dans le texte des avis"
                maxLength={LONGUEUR_MAX_RECHERCHE}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                style={{ border: 'none', width: '100%', minWidth: 0, fontSize: 'var(--text-sm)', fontFamily: 'inherit', color: 'var(--color-encre)' }}
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
                    <option value="all">Toutes les dates</option><option value="today">Aujourd'hui</option><option value="7">7 derniers jours</option><option value="14">14 derniers jours</option><option value="30">30 derniers jours</option><option value="90">90 derniers jours</option><option value="365">12 derniers mois</option>
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
                <select value={filtres.discordance} onChange={(e) => dispatch({ type: 'definir', champ: 'discordance', valeur: e.target.value })} aria-label="Filtrer les avis contradictoires">
                  <option value="all">Contradictoires ou non</option><option value="oui">Avis contradictoires uniquement</option>
                </select>
                <select value={filtres.theme} onChange={(e) => dispatch({ type: 'definir', champ: 'theme', valeur: e.target.value })} aria-label="Filtrer par thème">
                  <option value="all">Tous thèmes</option>
                  {filtres.theme !== 'all' && !themesDisponibles.includes(filtres.theme) && (
                    <option value={filtres.theme}>{filtres.theme === 'non_categorise' ? 'Non catégorisé' : themeLabel(filtres.theme)}</option>
                  )}
                  {themesDisponibles.map((t) => <option key={t} value={t}>{t === 'non_categorise' ? 'Non catégorisé' : themeLabel(t)}</option>)}
                </select>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Avis contradictoires : la note et le ton du texte se contredisent (par exemple 5/5 avec un texte négatif).
              </p>
              {themeCatalogError && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px', color: 'var(--color-text-body)', fontSize: 'var(--text-sm)' }}>
                  <span>Impossible de charger la liste complète des thèmes.</span>
                  <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReloadToken((token) => token + 1)}>Réessayer</button>
                </div>
              )}
            </details>
          </div>

          {/* Total serveur : nombre d'avis correspondant aux filtres, pas seulement ceux de la page. */}
          {!loadError && (
            <p role="status" aria-live="polite" className="feedbacks-total" style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
              {loading ? 'Recherche en cours…' : `${libelleTotal(total)}${filtresOuOnglet ? ' correspondant aux critères' : ''}`}
            </p>
          )}

          {/* Récapitulatif des filtres actifs */}
          {activeFilters.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} aria-label="Filtres actifs">
              {activeFilters.map((f) => (
                <span key={f.cle} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--color-active-item)', color: 'var(--color-primary-dark)', border: '1px solid var(--color-trait)', borderRadius: 'var(--radius-pill)', padding: '4px 6px 4px 12px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                  {f.libelle}
                  <button type="button" onClick={() => retirerFiltre(f.cle)} aria-label={`Retirer le filtre ${f.libelle}`} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'inherit' }}>
                    <XCloseIcon size={13} />
                  </button>
                </span>
              ))}
              <button type="button" onClick={reinitialiser} className="btn-secondary" style={{ padding: '4px 10px' }}>Tout réinitialiser</button>
            </div>
          )}

          {/* Tableau (grands écrans) */}
          <div className="feedbacks-desktop-table" style={{ background: 'var(--color-surface)', borderRadius: '20px', border: '1px solid var(--color-trait)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-trait)', background: 'var(--color-bg)' }}>
                  <th scope="col" style={th}>{afficherAgenceLigne ? 'Date et agence' : 'Date'}</th>
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
                    <tr key={i} aria-busy="true" style={{ borderBottom: '1px solid var(--color-trait)' }}>
                      <td colSpan={6} style={{ padding: '14px 16px' }}><SkeletonBlock height={40} radius="var(--radius-md)" /></td>
                    </tr>
                  ))
                ) : avis.length > 0 ? (
                  avis.map((f) => {
                    const statMeta = STATUT_BADGES[(f.statut_traitement || 'nouveau') as StatutTraitement] || STATUT_BADGES.nouveau;
                    return (
                      <tr key={f.id} style={{ borderBottom: '1px solid var(--color-trait)', cursor: 'pointer' }} onClick={() => setSelectedFeedbackForTreatment(f)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}>
                        <td style={{ padding: '14px 16px', minWidth: '140px' }}>
                          {afficherAgenceLigne && <div className="t-semi t-encre">{f.agence_nom || 'Agence'}</div>}
                          <div style={afficherAgenceLigne ? { fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', marginTop: '2px' } : { color: 'var(--color-encre)' }}>{formatDateAvis(f.date_soumission)}</div>
                        </td>
                        <td style={{ padding: '14px 16px', minWidth: '150px' }}><SignauxAvis feedback={f} /></td>
                        <td style={{ padding: '14px 16px', maxWidth: '340px' }}>
                          <div style={{ color: 'var(--color-encre)', lineHeight: 1.4, fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {f.commentaire || 'Pas de commentaire écrit.'}
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px', minWidth: '140px' }}>
                          <span style={{ background: 'var(--color-neutre-fond)', color: 'var(--color-text-2)', padding: '4px 10px', borderRadius: '8px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                            {f.analyse_ia?.theme_principal ? themeLabel(f.analyse_ia.theme_principal) : 'Non catégorisé'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          <span style={{ background: statMeta.bg, color: statMeta.text, padding: '3px 10px', borderRadius: '9999px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            {statMeta.icon}
                            {statMeta.label}
                          </span>
                          {f.issue_id && <div style={{ marginTop: '6px', color: 'var(--color-neutre-texte)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Rattaché à un problème</div>}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedFeedbackForTreatment(f); }} className="btn-secondary" style={{ padding: '6px 12px', borderRadius: '10px' }}>Consulter</button>
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
              <span className="t-xs t-2 t-semi">{debutPage}–{finPage} sur {total}</span>
              {pages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button type="button" onClick={() => dispatch({ type: 'page', page: pageCourante - 1 })} disabled={pageCourante === 0} className="btn-secondary"
                    style={{ padding: '6px 14px', minHeight: 44, cursor: pageCourante === 0 ? 'default' : 'pointer', opacity: pageCourante === 0 ? 0.45 : 1 }}>Précédent</button>
                  <span className="t-xs t-semi t-encre">Page {pageCourante + 1} / {pages}</span>
                  <button type="button" onClick={() => dispatch({ type: 'page', page: pageCourante + 1 })} disabled={pageCourante >= pages - 1} className="btn-secondary"
                    style={{ padding: '6px 14px', minHeight: 44, cursor: pageCourante >= pages - 1 ? 'default' : 'pointer', opacity: pageCourante >= pages - 1 ? 0.45 : 1 }}>Suivant</button>
                </div>
              )}
            </nav>
          )}
        </section>
      )}

      {/* ── ONGLET 4 : THÈMES (agrégat serveur sur tous les avis correspondant aux filtres) ── */}
      {filtres.onglet === 'thematiques' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div id="feedbacks-themes"><SectionHeading>Thèmes des avis</SectionHeading></div>
          {loading && (
            <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
              {[0, 1, 2].map((i) => <SkeletonBlock key={i} height={150} radius="var(--radius-xl)" />)}
            </div>
          )}
          {!loading && loadError && <EmptyState illustration="no-data" title="Impossible de charger les thèmes" message="Une erreur est survenue lors du chargement des thèmes." action={{ label: 'Réessayer', onClick: () => setReloadToken((token) => token + 1) }} />}
          {!loading && !loadError && themes.length === 0 && (
            <EmptyState illustration="no-data" title="Aucun thème disponible" message={totalThemes === 0 ? 'Aucun avis dans ce périmètre.' : 'Aucun thème analysé pour ces avis.'} />
          )}
          {!loading && !loadError && totalThemes > 0 && (
            <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              {`Analyse basée sur les ${totalThemes} avis correspondant aux filtres, sur toute la période choisie (20 thèmes au plus). `}
              {DEFINITION_NEGATIF}
            </p>
          )}
          {!loadError && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
              {!loading && themes.map((thm) => (
                <div key={thm.theme} style={{ background: 'var(--color-surface)', borderRadius: '20px', padding: '20px 24px', border: '1px solid var(--color-trait)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '14px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span className="t-semi t-base t-encre">{thm.theme === 'non_categorise' ? 'Non catégorisé' : themeLabel(thm.theme)}</span>
                      <span style={{ background: 'var(--color-encre)', color: 'var(--color-text-inverse)', padding: '2px 8px', borderRadius: '9999px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>{thm.count} avis ({thm.pourcentage.toLocaleString('fr-FR')} %)</span>
                    </div>
                    <ThemeAgences theme={thm} />
                    <p style={{ margin: '0 0 8px', color: 'var(--color-text-2)', fontSize: 'var(--text-sm)' }}>
                      {thm.part_negatifs
                        ? <PartNegatifsTexte pn={thm.part_negatifs} />
                        : <><strong>{thm.negatifs ?? 0}</strong> avis négatif{(thm.negatifs ?? 0) > 1 ? 's' : ''} sur {thm.count}</>}
                    </p>
                    <ThemeTonGravite theme={thm} />
                    <ThemeVerbatim theme={thm} />
                  </div>
                  <button type="button" onClick={() => { dispatch({ type: 'definir', champ: 'theme', valeur: thm.theme }); dispatch({ type: 'definir', champ: 'onglet', valeur: 'tous' }); }}
                    className="btn-secondary" style={{ padding: '8px', borderRadius: '10px', width: '100%', justifyContent: 'center', minHeight: 44 }}>
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { veilleApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Agence, SentimentType, VeilleFacebookStatus, VeilleMention, VeilleSyntheseResponse } from '../../types';
import SectionHeading from '../../components/ui/SectionHeading';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import EmptyState from '../../components/ui/EmptyState';
import PeriodSelector from '../../components/stats/PeriodSelector';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import VeilleServiceStatus from '../../components/veille/VeilleServiceStatus';
import VeilleSentimentFilter from '../../components/veille/VeilleSentimentFilter';
import VeilleInfoBanner from '../../components/veille/VeilleInfoBanner';
import VeilleKpiRow from '../../components/veille/VeilleKpiRow';
import VeilleDailyChart from '../../components/veille/VeilleDailyChart';
import VeilleThemeChart from '../../components/veille/VeilleThemeChart';
import VeilleMentionCard from '../../components/veille/VeilleMentionCard';
import Alert, { type AlertTone } from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import { RefreshCwIcon, AlertTriangleIcon, ExternalLinkIcon } from '../../components/common/Icons';
import { themeLabel } from '../../utils/themeLabels';
import { userFacingError } from '../../utils/userFacingError';

const PAGE_SIZE = 25;

// Paramètres ajoutés par le service de veille au retour de l'autorisation Facebook
// (status=success&pages=N | status=denied | status=error&code=...).
const PARAMS_RETOUR_FACEBOOK = ['status', 'pages', 'code'];

type MessageVeille = { tone: AlertTone; title: string; body?: string };

function messageRetourFacebook(statut: string, pages: string | null): MessageVeille {
  if (statut === 'success') {
    const n = Number(pages) || 0;
    return n > 0
      ? { tone: 'success', title: n > 1 ? `${n} Pages Facebook connectées.` : 'Page Facebook connectée.', body: 'Vous pouvez maintenant collecter ses commentaires.' }
      : { tone: 'warning', title: "Aucune Page n'a été connectée.", body: "Vérifiez que vous administrez la Page et qu'elle est bien sélectionnée dans la fenêtre Facebook, puis réessayez." };
  }
  if (statut === 'denied') {
    return { tone: 'warning', title: 'Connexion Facebook annulée.', body: "L'autorisation n'a pas été accordée ; aucune Page n'a été connectée." };
  }
  return { tone: 'critical', title: 'La connexion Facebook a échoué.', body: 'Veuillez réessayer dans quelques minutes.' };
}

// Défense en profondeur : l'API ne renvoie déjà qu'une URL facebook.com.
function estUrlAutorisationFacebook(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'facebook.com' || u.hostname.endsWith('.facebook.com'));
  } catch {
    return false;
  }
}

function messageErreurCollecte(err: any): string {
  const code = err?.response?.status;
  if (code === 409) return 'Reconnectez votre Page Facebook pour relancer la collecte.';
  if (code === 404) return "Cette Page n'est pas connectée à votre organisation.";
  return userFacingError(err, 'La collecte Facebook a échoué. Veuillez réessayer dans quelques minutes.');
}

export default function VeillePage() {
  const user = useAuthStore((s) => s.user);
  const isCxManager = user?.role === 'cx_manager';

  // Tous les hooks sont appelés avant toute condition de retour (Rules of Hooks) —
  // un non-CX-Manager est redirigé plus bas, sans qu'aucun appel /veille ne soit émis
  // (chaque effet ci-dessous vérifie isCxManager avant de lancer une requête).
  const [jours, setJours] = useState(30);
  const [selectedAgenceId, setSelectedAgenceId] = useState<string | null>(null);
  const [selectedSentiment, setSelectedSentiment] = useState<SentimentType | null>(null);
  const [selectedTheme, setSelectedTheme] = useState('');
  const [plateforme, setPlateforme] = useState('');
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(0);

  const [agencesList, setAgencesList] = useState<Agence[]>([]);
  const [status, setStatus] = useState<VeilleFacebookStatus | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [message, setMessage] = useState<MessageVeille | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [synthese, setSynthese] = useState<VeilleSyntheseResponse | null>(null);
  const [mentions, setMentions] = useState<VeilleMention[]>([]);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mentionsError, setMentionsError] = useState<string | null>(null);
  const [syntheseError, setSyntheseError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCxManager) return;
    agencesApi
      .list()
      .then((res) => {
        if (Array.isArray(res.data)) setAgencesList(res.data);
      })
      .catch(() => setAgencesList([]));
  }, [isCxManager]);

  const fetchStatus = useCallback(() => {
    if (!isCxManager) return;
    veilleApi
      .facebookStatus()
      .then((res) => setStatus(res.data))
      .catch(() => setStatus(null));
  }, [isCxManager]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Retour de l'autorisation Facebook : message, statut rafraîchi, puis URL nettoyée.
  const statutRetour = searchParams.get('status');
  useEffect(() => {
    if (!isCxManager || !statutRetour) return;
    setMessage(messageRetourFacebook(statutRetour, searchParams.get('pages')));
    fetchStatus();
    const nettoyes = new URLSearchParams(searchParams);
    PARAMS_RETOUR_FACEBOOK.forEach((cle) => nettoyes.delete(cle));
    setSearchParams(nettoyes, { replace: true });
  }, [isCxManager, statutRetour, searchParams, setSearchParams, fetchStatus]);

  const dateDebut = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - jours);
    return d.toISOString();
  }, [jours]);

  const fetchData = useCallback(async () => {
    if (!isCxManager) return;
    setLoading(true);
    setError(null);
    setMentionsError(null);
    setSyntheseError(null);
    try {
      const filtresPeriode = { date_debut: dateDebut, agence_id: selectedAgenceId || undefined, plateforme: plateforme || undefined };
      const [mentionsRes, syntheseRes] = await Promise.allSettled([
        veilleApi.mentions({
          ...filtresPeriode,
          sentiment: selectedSentiment || undefined,
          theme: selectedTheme || undefined,
          plateforme: plateforme || undefined,
          recherche: recherche.trim() || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        veilleApi.synthese(filtresPeriode),
      ]);
      if (mentionsRes.status === 'fulfilled') {
        setMentions(mentionsRes.value.data.items);
        setTotal(mentionsRes.value.data.total);
      } else {
        setMentionsError(userFacingError(mentionsRes.reason, 'Impossible de charger les mentions. Veuillez réessayer.'));
      }
      if (syntheseRes.status === 'fulfilled') {
        setSynthese(syntheseRes.value.data);
      } else {
        setSyntheseError(userFacingError(syntheseRes.reason, 'Impossible de charger les indicateurs. Veuillez réessayer.'));
      }
      if (mentionsRes.status === 'rejected' && syntheseRes.status === 'rejected') {
        setError('Les mentions et les indicateurs sont momentanément indisponibles.');
      }
    } catch (err: any) {
      setError(userFacingError(err, 'Impossible de charger les mentions. Veuillez réessayer.'));
    } finally {
      setLoading(false);
    }
  }, [isCxManager, dateDebut, selectedAgenceId, selectedSentiment, selectedTheme, plateforme, recherche, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Retour à la première page quand un filtre (hors pagination) change.
  useEffect(() => {
    setPage(0);
  }, [jours, selectedAgenceId, selectedSentiment, selectedTheme, plateforme, recherche]);

  const connecterFacebook = async () => {
    setConnecting(true);
    setMessage(null);
    try {
      const res = await veilleApi.facebookConnect();
      if (!estUrlAutorisationFacebook(res.data.authorize_url)) throw new Error('URL inattendue');
      window.location.assign(res.data.authorize_url);
    } catch (err) {
      setMessage({ tone: 'critical', title: 'Connexion Facebook impossible.', body: userFacingError(err, 'Le service de veille ne répond pas. Veuillez réessayer dans quelques minutes.') });
      setConnecting(false);
    }
  };

  const collecterMaintenant = async () => {
    setCollecting(true);
    setMessage(null);
    try {
      const res = await veilleApi.facebookScrape();
      const n = res.data.ingestion?.ingested_count ?? 0;
      setMessage({
        tone: 'success',
        title: n === 0 ? 'Aucune nouvelle mention.' : n === 1 ? '1 nouvelle mention.' : `${n} nouvelles mentions.`,
      });
      fetchData();
    } catch (err) {
      setMessage({ tone: 'critical', title: 'Collecte impossible.', body: messageErreurCollecte(err) });
    } finally {
      fetchStatus();
      setCollecting(false);
    }
  };

  if (!isCxManager) {
    return <Navigate to={user?.role === 'admin' ? '/admin/dashboard' : '/agence'} replace />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const serviceOffline = status !== null && status.service !== 'online';
  const serviceOnline = status?.service === 'online';
  const pagesFacebook = status?.pages_disponibles ? status.pages : [];
  const pageActive = pagesFacebook.some((p) => p.status === 'active');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* ── En-tête ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
            Veille réseaux sociaux
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: 'var(--color-text-muted)', maxWidth: '560px' }}>
            Mentions publiques (Facebook) analysées automatiquement par IKAN AI.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          <VeilleServiceStatus status={status} />
          {serviceOnline && status?.pages_disponibles && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {pageActive && (
                <Button size="sm" icon={<RefreshCwIcon size={14} />} loading={collecting} disabled={connecting} onClick={collecterMaintenant}>
                  Collecter maintenant
                </Button>
              )}
              <Button
                size="sm"
                variant={pageActive ? 'secondary' : 'primary'}
                iconEnd={<ExternalLinkIcon size={14} />}
                loading={connecting}
                disabled={collecting}
                onClick={connecterFacebook}
              >
                {pagesFacebook.length > 0 ? 'Reconnecter ma Page Facebook' : 'Connecter ma Page Facebook'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {message && (
        <Alert tone={message.tone} title={message.title} onDismiss={() => setMessage(null)}>
          {message.body}
        </Alert>
      )}

      {/* ── Filtres ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <VeilleSentimentFilter value={selectedSentiment} onChange={setSelectedSentiment} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <input aria-label="Rechercher dans les mentions" placeholder="Rechercher un texte…" value={recherche} onChange={(e) => setRecherche(e.target.value)} style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-main)' }} />
          <select aria-label="Plateforme" value={plateforme} onChange={(e) => setPlateforme(e.target.value)} style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-main)' }}>
            <option value="">Toutes les plateformes</option><option value="facebook">Facebook</option><option value="google_reviews">Google</option>
          </select>
          <select aria-label="Thème" value={selectedTheme} onChange={(e) => setSelectedTheme(e.target.value)} style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-main)' }}>
            <option value="">Tous les thèmes</option><option value="non_classe">Non classé</option>
            {synthese?.par_theme.filter((t) => t.theme_principal).map((t) => <option key={t.theme_principal} value={t.theme_principal!}>{themeLabel(t.theme_principal)}</option>)}
          </select>
          <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
          <PeriodSelector value={jours} onChange={setJours} />
        </div>
      </div>

      {/* ── Encart d'information, toujours visible ── */}
      <VeilleInfoBanner />

      {/* ── États : chargement / erreur ── */}
      {loading && !synthese && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} aria-busy="true">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} height={82} radius="var(--radius-lg)" />
            ))}
          </div>
          <SkeletonBlock height={280} radius="var(--radius-2xl)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} height={120} radius="var(--radius-2xl)" />
            ))}
          </div>
        </div>
      )}

      {error && !loading && !synthese && mentions.length === 0 && (
        <div className="saas-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center', padding: '40px 20px' }}>
          <AlertTriangleIcon size={28} color="var(--color-error)" />
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-text-main)' }}>Impossible de charger les mentions</p>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>{error}</p>
          <button type="button" className="btn-primary" onClick={fetchData}>
            <RefreshCwIcon size={14} /> Réessayer
          </button>
        </div>
      )}

      {/* ── Contenu ── */}
      {!loading && (
        <>
          {synthese && <div>
            <SectionHeading>Vue d'ensemble</SectionHeading>
            <div style={{ marginTop: '12px' }}>
              <VeilleKpiRow synthese={synthese} />
            </div>
          </div>}
          {syntheseError && <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)' }}>{syntheseError}</p>}

          {synthese && <div>
            <SectionHeading>Évolution journalière</SectionHeading>
            <div className="saas-card" style={{ marginTop: '12px' }}>
              <VeilleDailyChart data={synthese.serie_journaliere} />
            </div>
          </div>}

          {synthese && <div>
            <SectionHeading>Répartition par thème</SectionHeading>
            <div className="saas-card" style={{ marginTop: '12px' }}>
              <VeilleThemeChart data={synthese.par_theme} />
            </div>
          </div>}

          <div>
            <SectionHeading>Mentions</SectionHeading>
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {mentionsError ? (
                <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)' }}>{mentionsError}</p>
              ) : mentions.length === 0 ? (
                <div className="saas-card">
                  <EmptyState
                    title={serviceOffline ? 'Le service de collecte est hors ligne' : 'Aucune mention pour ces filtres'}
                    message={
                      serviceOffline
                        ? "Impossible de confirmer l'état du service de collecte des mentions en ce moment. Les mentions déjà collectées restent visibles ici dès qu'il y en a."
                        : 'Essayez une autre période, une autre agence ou un autre sentiment.'
                    }
                    illustration="no-data"
                  />
                </div>
              ) : (
                <>
                  {mentions.map((m) => (
                    <VeilleMentionCard key={m.id} mention={m} />
                  ))}

                  {totalPages > 1 && (
                    <nav aria-label="Pagination des mentions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                        {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} sur {total}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setPage((p) => p - 1)}
                          disabled={page === 0}
                          className="btn-secondary"
                          style={{ padding: '6px 14px', fontSize: '0.8rem', opacity: page === 0 ? 0.45 : 1 }}
                        >
                          Précédent
                        </button>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
                          Page {page + 1} / {totalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPage((p) => p + 1)}
                          disabled={page >= totalPages - 1}
                          className="btn-secondary"
                          style={{ padding: '6px 14px', fontSize: '0.8rem', opacity: page >= totalPages - 1 ? 0.45 : 1 }}
                        >
                          Suivant
                        </button>
                      </div>
                    </nav>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

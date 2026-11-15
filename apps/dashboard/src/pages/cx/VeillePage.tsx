import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { veilleApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Agence, SentimentType, VeilleFacebookStatus, VeilleMention as Mention, VeilleSyntheseResponse } from '../../types';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import PageTitle from '../../components/ui/PageTitle';
import PeriodSelector from '../../components/stats/PeriodSelector';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import VeilleSource, { etatSource, type EtatSource } from '../../components/veille/VeilleSource';
import VeilleSynthese from '../../components/veille/VeilleSynthese';
import VeilleThemes from '../../components/veille/VeilleThemes';
import VeilleFiltres from '../../components/veille/VeilleFiltres';
import VeilleMention from '../../components/veille/VeilleMention';
import VeilleDailyChart from '../../components/veille/VeilleDailyChart';
import Alert, { type AlertTone } from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import { RefreshCwIcon, AlertTriangleIcon, InfoIcon, MegaphoneIcon, MessageSquareIcon } from '../../components/common/Icons';
import { userFacingError } from '../../utils/userFacingError';
import { libellePeriode } from '../../utils/periodes';
import { formaterNombre } from '../../utils/formatNombre';
import './veille.css';

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

/** Période plus large proposée quand la période courante est vide (null : déjà la plus large). */
const periodeSuivante = (jours: number): number | null => (jours < 30 ? 30 : jours < 90 ? 90 : jours < 365 ? 365 : null);

/**
 * Période vide : UN seul état, adapté à la situation, au lieu de compteurs à zéro et de graphiques vides.
 * L'action principale (connecter, collecter) reste dans le bandeau Source ; ici, seulement des pistes secondaires.
 */
function VeilleVide({ etat, jours, agenceFiltree, onPeriode, onToutesAgences }: { etat: EtatSource; jours: number; agenceFiltree: boolean; onPeriode: (j: number) => void; onToutesAgences: () => void }) {
  if (etat === 'sans-page') {
    return (
      <section className="saas-card veille-vide" aria-labelledby="veille-vide-titre">
        <span className="veille-vide__icone" aria-hidden="true"><MegaphoneIcon size={24} /></span>
        <h2 id="veille-vide-titre" className="veille-vide__titre">Ce que vos clients disent de vous, publiquement</h2>
        <p className="veille-vide__texte">Les commentaires publiés sur votre Page Facebook rejoignent IKAN AI, à côté des avis recueillis par QR code.</p>
        <ol className="veille-vide__etapes">
          <li><strong>Connectez votre Page</strong>Avec le bouton ci-dessus, depuis un compte administrateur de la Page.</li>
          <li><strong>IKAN AI collecte</strong>Seuls les commentaires publics sont lus ; rien n’est publié en votre nom.</li>
          <li><strong>Lisez les tendances</strong>Chaque mention reçoit un ton et un thème ; les tendances s’affichent ici.</li>
        </ol>
      </section>
    );
  }
  const suivante = periodeSuivante(jours);
  const horsLigne = etat === 'hors-ligne';
  return (
    <section className="saas-card veille-vide" aria-labelledby="veille-vide-titre">
      <span className="veille-vide__icone" aria-hidden="true"><MessageSquareIcon size={24} /></span>
      <h2 id="veille-vide-titre" className="veille-vide__titre">
        Aucune mention sur les {libellePeriode(jours)}{agenceFiltree ? ' pour cette agence' : ''}
      </h2>
      <p className="veille-vide__texte">
        {horsLigne
          ? 'Les nouvelles mentions arriveront dès le retour du service de collecte.'
          : etat === 'connectee'
            ? 'Lancez une collecte pour récupérer les derniers commentaires, ou élargissez la période.'
            : 'Élargissez la période ou revenez une fois la Page reconnectée.'}
      </p>
      {(suivante || agenceFiltree) && (
        <div className="veille-vide__actions">
          {suivante && <Button size="sm" variant="secondary" onClick={() => onPeriode(suivante)}>Voir les {libellePeriode(suivante)}</Button>}
          {agenceFiltree && <Button size="sm" variant="ghost" onClick={onToutesAgences}>Toutes les agences</Button>}
        </div>
      )}
    </section>
  );
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
  // Une seule plateforme collectée aujourd'hui (Facebook) : le filtre n'est plus proposé, la valeur reste vide.
  const plateforme = '';
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(0);
  const mentionsRef = useRef<HTMLElement>(null);

  const [agencesList, setAgencesList] = useState<Agence[]>([]);
  const [status, setStatus] = useState<VeilleFacebookStatus | null | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();
  const [message, setMessage] = useState<MessageVeille | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [synthese, setSynthese] = useState<VeilleSyntheseResponse | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
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
  const etat = etatSource(status);
  const periode = `sur les ${libellePeriode(jours)}`;
  const filtresActifs = selectedSentiment !== null || selectedTheme !== '' || recherche.trim() !== '';
  const periodeVide = synthese !== null && synthese.total === 0 && !syntheseError;
  const premierChargement = loading && !synthese && mentions.length === 0;

  const choisirTheme = (theme: string) => {
    setSelectedTheme(theme);
    mentionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="veille-page">
      <PageTitle
        title="Réseaux sociaux"
        description="Ce que vos clients disent publiquement de vous sur Facebook, lu et classé automatiquement par IKAN AI."
        actions={
          <div className="veille-page__filtres">
            <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
            <PeriodSelector value={jours} onChange={setJours} />
          </div>
        }
      />

      <VeilleSource status={status} collecte={collecting} connexion={connecting} onCollecter={collecterMaintenant} onConnecter={connecterFacebook} />

      {message && (
        <Alert tone={message.tone} title={message.title} onDismiss={() => setMessage(null)}>
          {message.body}
        </Alert>
      )}

      {premierChargement && (
        <div className="veille-page" aria-busy="true" aria-label="Chargement des mentions">
          <SkeletonBlock height={150} radius="var(--radius-2xl)" />
          <div className="veille-grille">
            <SkeletonBlock height={320} radius="var(--radius-2xl)" />
            <SkeletonBlock height={320} radius="var(--radius-2xl)" />
          </div>
          <SkeletonBlock height={260} radius="var(--radius-2xl)" />
        </div>
      )}

      {error && !loading && !synthese && mentions.length === 0 && (
        <section className="saas-card veille-vide" role="alert">
          <span className="veille-vide__icone" aria-hidden="true"><AlertTriangleIcon size={24} /></span>
          <h2 className="veille-vide__titre">Impossible de charger les mentions</h2>
          <p className="veille-vide__texte">{error}</p>
          <Button size="sm" variant="secondary" icon={<RefreshCwIcon size={14} />} onClick={fetchData}>Réessayer</Button>
        </section>
      )}

      {!premierChargement && !error && periodeVide && (
        <VeilleVide etat={etat} jours={jours} agenceFiltree={!!selectedAgenceId} onPeriode={setJours} onToutesAgences={() => setSelectedAgenceId(null)} />
      )}

      {!premierChargement && !(error && !synthese && mentions.length === 0) && !periodeVide && (
        <>
          {syntheseError && <p role="status" className="veille-note"><AlertTriangleIcon size={14} aria-hidden="true" />{syntheseError}</p>}

          {synthese && (
            <>
              <VeilleSynthese synthese={synthese} periode={periode} />

              <div className="veille-grille">
                <section className="saas-card veille-panneau" aria-labelledby="veille-jour-titre">
                  <div>
                    <h2 id="veille-jour-titre" className="veille-panneau__titre">Mentions par jour</h2>
                    <p className="veille-panneau__sous-titre">Le ton de chaque journée, {periode}.</p>
                  </div>
                  <VeilleDailyChart data={synthese.serie_journaliere} />
                </section>
                <section className="saas-card veille-panneau" aria-labelledby="veille-themes-titre">
                  <div>
                    <h2 id="veille-themes-titre" className="veille-panneau__titre">De quoi parlent-ils ?</h2>
                    <p className="veille-panneau__sous-titre">Choisissez un thème pour lire ses mentions.</p>
                  </div>
                  <VeilleThemes data={synthese.par_theme} onChoisir={choisirTheme} actif={selectedTheme} />
                </section>
              </div>

              <p className="veille-note">
                <InfoIcon size={14} aria-hidden="true" />
                Ces mentions restent séparées des indicateurs de satisfaction fondés sur les notes. Le ton et le thème sont attribués automatiquement : l’ironie, les emojis et les langues locales peuvent être mal interprétés.
              </p>
            </>
          )}

          <section ref={mentionsRef} className="veille-mentions" aria-labelledby="veille-mentions-titre">
            <div className="veille-mentions__entete">
              <h2 id="veille-mentions-titre" className="veille-mentions__titre">Mentions</h2>
              {!mentionsError && (
                <span className="veille-mentions__compte" aria-live="polite">
                  {formaterNombre(total, 0)} mention{total > 1 ? 's' : ''}
                  {filtresActifs && synthese ? ` sur ${formaterNombre(synthese.total, 0)}` : ''}
                </span>
              )}
            </div>

            <VeilleFiltres
              sentiment={selectedSentiment}
              onSentiment={setSelectedSentiment}
              theme={selectedTheme}
              onTheme={setSelectedTheme}
              recherche={recherche}
              onRecherche={setRecherche}
              themes={synthese?.par_theme ?? []}
            />

            {mentionsError ? (
              <p role="status" className="saas-card veille-vide-court">{mentionsError}</p>
            ) : mentions.length === 0 ? (
              <div className="saas-card veille-vide">
                <p className="veille-vide__titre">Aucune mention ne correspond à ces filtres</p>
                <p className="veille-vide__texte">Essayez un autre ton, un autre thème ou un autre mot.</p>
                {filtresActifs && (
                  <Button size="sm" variant="secondary" onClick={() => { setSelectedSentiment(null); setSelectedTheme(''); setRecherche(''); }}>
                    Effacer les filtres
                  </Button>
                )}
              </div>
            ) : (
              <div className="saas-card" style={{ padding: 0, overflow: 'hidden' }}>
                <ul className="veille-liste" aria-busy={loading}>
                  {mentions.map((m) => (
                    <VeilleMention key={m.id} mention={m} />
                  ))}
                </ul>
                {totalPages > 1 && (
                  <nav className="veille-pagination" aria-label="Pagination des mentions">
                    <span className="veille-pagination__etendue">
                      {formaterNombre(page * PAGE_SIZE + 1, 0)}–{formaterNombre(Math.min((page + 1) * PAGE_SIZE, total), 0)} sur {formaterNombre(total, 0)}
                    </span>
                    <div className="veille-pagination__boutons">
                      <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
                      <span className="veille-pagination__etendue">Page {page + 1} / {totalPages}</span>
                      <Button size="sm" variant="secondary" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
                    </div>
                  </nav>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

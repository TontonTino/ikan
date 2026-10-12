/**
 * Vue d'ensemble du Responsable d'agence (/agence).
 *
 * « Où en est mon agence ? Qu'est-ce qui demande mon attention ? Que faire ensuite ? »
 * Ordre de lecture (= ordre du DOM = ordre clavier), même composition que la vue réseau du CX Manager :
 *   SITUATION → PRIORITÉS → ÉVOLUTION → CE QUE DISENT LES CLIENTS → RECOMMANDATIONS → SUIVI DES PROBLÈMES
 *
 * Toutes les données sont celles d'UNE seule agence (dashboardApi.agence, recommandationsApi.listAgence, issuesApi,
 * alertes filtrées par rôle côté API — voir verifier_acces_agence). Aucune donnée simulée, aucun KPI inventé,
 * aucune comparaison que l'API ne fournit pas. Une source en échec est signalée : jamais présentée comme « rien à signaler ».
 * Règles de lecture (priorités, tri des recommandations) : components/agency/agenceVue.ts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dashboardApi, recommandationsApi, alertesApi, issuesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { DashboardAgence, Recommandation, Alerte, AlerteFeedback, IssueStatut } from '../../types';
import PageTitle from '../../components/ui/PageTitle';
import IconButton from '../../components/ui/IconButton';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import KpiCard from '../../components/ui/KpiCard';
import { BentoGrid, BentoItem } from '../../components/ui/BentoGrid';
import { useToast } from '../../components/ui/Toast';
import { RefreshIcon, SmileIcon, MessageSquareIcon, AlertTriangleIcon, ClockIcon } from '../../components/common/Icons';
import AgencyDecisionKpis from '../../components/agency/AgencyDecisionKpis';
import AgencyPriorities from '../../components/agency/AgencyPriorities';
import AgencyEvolution from '../../components/agency/AgencyEvolution';
import { TonDesAvis, ThemesDesAvis } from '../../components/agency/AgencyClients';
import AgencyRecommendations from '../../components/agency/AgencyRecommendations';
import AgencyProblemes, { type ProblemesSnapshot } from '../../components/agency/AgencyProblemes';
import { construirePriorites, PROBLEMES_OUVERTS } from '../../components/agency/agenceVue';

const RESULT_ISSUE_STATUSES: IssueStatut[] = ['resolue', 'verifiee'];
const ISSUE_STATUSES: IssueStatut[] = [...PROBLEMES_OUVERTS, ...RESULT_ISSUE_STATUSES];
const ISSUE_LIMIT = 200;
const PERIODES = [
  { v: 7, l: '7 jours' },
  { v: 30, l: '30 jours' },
  { v: 90, l: '90 jours' },
];

async function loadAgencyIssues(agenceId: string): Promise<ProblemesSnapshot> {
  const responses = await Promise.all(ISSUE_STATUSES.map((statut) =>
    issuesApi.list({ agence_id: agenceId, statut, limit: ISSUE_LIMIT }),
  ));
  const totals = Object.fromEntries(ISSUE_STATUSES.map((statut, index) => {
    const response = responses[index];
    const count = Number(response.headers?.['x-total-count']);
    return [statut, Number.isFinite(count) && count >= 0 ? Math.max(count, response.data?.length ?? 0) : response.data?.length ?? 0];
  })) as Record<IssueStatut, number>;
  return {
    items: responses.flatMap((response) => response.data ?? []),
    totals,
    truncated: responses.some((response, index) => totals[ISSUE_STATUSES[index]] > (response.data?.length ?? 0)),
  };
}

export default function DashboardAgencePage() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const [data, setData] = useState<DashboardAgence | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [feedbackAlerts, setFeedbackAlerts] = useState<AlerteFeedback[]>([]);
  const [issues, setIssues] = useState<ProblemesSnapshot | null>(null);
  const [sourceErrors, setSourceErrors] = useState({ dashboard: false, recommendations: false, alerts: false, issues: false });
  const [recos, setRecos] = useState<Recommandation[]>([]);
  const [recosTotal, setRecosTotal] = useState(0);
  const [recosLoadingMore, setRecosLoadingMore] = useState(false);
  const [jours, setJours] = useState(30);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const agenceId = user?.agence_id;

  const load = useCallback(() => {
    if (!agenceId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setRecosLoadingMore(false);
    setSourceErrors({ dashboard: false, recommendations: false, alerts: false, issues: false });
    Promise.allSettled([
      dashboardApi.agence(agenceId, jours),
      recommandationsApi.listAgence(agenceId, { limit: 50, offset: 0 }),
      alertesApi.list(),
      loadAgencyIssues(agenceId),
    ])
      .then(([dashboard, recommendations, alerts, issuesResult]) => {
        if (requestId !== requestIdRef.current) return;
        // En cas d'échec, les données déjà affichées sont conservées : seule la source en erreur est signalée.
        if (dashboard.status === 'fulfilled') setData(dashboard.value.data);
        else { console.error('Erreur chargement du dashboard agence:', dashboard.reason); setSourceErrors((current) => ({ ...current, dashboard: true })); }
        if (recommendations.status === 'fulfilled') {
          setRecos(recommendations.value.data ?? []);
          setRecosTotal(Number(recommendations.value.headers?.['x-total-count'] ?? recommendations.value.data?.length ?? 0));
        } else { setSourceErrors((current) => ({ ...current, recommendations: true })); }
        if (alerts.status === 'fulfilled') {
          const response = alerts.value.data;
          setAlertes((response?.alertes_seuil ?? []).filter((item: Alerte) => item.agence_id === agenceId));
          setFeedbackAlerts((response?.alertes_feedback ?? []).filter((item: AlerteFeedback) => item.agence_id === agenceId));
        } else { setSourceErrors((current) => ({ ...current, alerts: true })); }
        if (issuesResult.status === 'fulfilled') setIssues(issuesResult.value);
        else { setSourceErrors((current) => ({ ...current, issues: true })); }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [agenceId, jours]);

  useEffect(() => {
    load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  const marquerTraitee = async (id: string) => {
    try {
      await recommandationsApi.marquerTraitee(id);
      toast.show({ message: 'Recommandation marquée comme traitée', tone: 'success' });
      load();
    } catch {
      toast.show({ message: 'Impossible d’enregistrer la modification. Réessayez.', tone: 'critical' });
    }
  };

  const loadMoreRecos = async () => {
    if (!agenceId || recosLoadingMore || recos.length >= recosTotal) return;
    const requestId = requestIdRef.current;
    setRecosLoadingMore(true);
    try {
      const response = await recommandationsApi.listAgence(agenceId, { limit: 50, offset: recos.length });
      if (requestId === requestIdRef.current) {
        const connues = new Set(recos.map((r) => r.id));
        setRecos((current) => [...current, ...((response.data || []) as Recommandation[]).filter((r) => !connues.has(r.id))]);
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        console.error('Erreur chargement des recommandations suivantes:', error);
        toast.show({ message: 'Impossible de charger les recommandations suivantes', tone: 'critical' });
      }
    } finally {
      if (requestId === requestIdRef.current) setRecosLoadingMore(false);
    }
  };

  const priorites = useMemo(
    () =>
      construirePriorites({
        alertes: sourceErrors.alerts ? [] : alertes,
        avis: sourceErrors.alerts ? [] : feedbackAlerts,
        problemes: sourceErrors.issues || !issues ? [] : issues.items,
      }),
    [alertes, feedbackAlerts, issues, sourceErrors.alerts, sourceErrors.issues],
  );

  if (!agenceId) {
    return (
      <EmptyState
        title="Aucune agence rattachée à votre compte"
        message="Contactez votre CX Manager pour être rattaché à une agence."
        fullHeight
      />
    );
  }

  const nomAgence = data?.agence_nom || user?.agence_nom || 'Mon agence';
  const premierChargement = loading && !data;
  const indicateursEnEchec = !loading && sourceErrors.dashboard;

  return (
    <div className="agence">
      <PageTitle
        title="Vue d’ensemble"
        description={`${nomAgence} · où en est l’agence, ce qui demande votre attention, ce qu’il faut faire ensuite.`}
        actions={
          <>
            <div className="ui-segmented" role="group" aria-label="Période">
              {PERIODES.map((p) => (
                <button key={p.v} type="button" className="ui-segmented__item" aria-pressed={jours === p.v} onClick={() => setJours(p.v)}>
                  {p.l}
                </button>
              ))}
            </div>
            <IconButton label="Actualiser les données" icon={<RefreshIcon size={16} />} onClick={load} />
          </>
        }
      />

      {indicateursEnEchec && (
        <Alert
          tone="warning"
          title={data ? 'Les indicateurs n’ont pas pu être actualisés : les dernières données chargées restent affichées.' : 'Impossible de charger les indicateurs de l’agence. Les priorités et recommandations disponibles restent affichées.'}
          action={<Button size="sm" variant="secondary" onClick={load}>Réessayer</Button>}
        />
      )}

      <BentoGrid aria-busy={loading || undefined}>
        <h2 className="ui-sr-only">Situation de l’agence</h2>

        {/* SITUATION */}
        {data ? (
          <AgencyDecisionKpis data={data} jours={jours} />
        ) : (
          <>
            {[
              { icon: <SmileIcon />, label: 'Satisfaction' },
              { icon: <MessageSquareIcon />, label: 'Avis reçus' },
              { icon: <AlertTriangleIcon />, label: 'Avis critiques' },
              { icon: <ClockIcon />, label: 'Avis à traiter' },
            ].map((k) => (
              <BentoItem key={k.label} size="kpi" as="div">
                <KpiCard icon={k.icon} label={k.label} value={premierChargement ? '—' : 'Indisponible'} loading={premierChargement} tone="neutral" />
              </BentoItem>
            ))}
          </>
        )}

        {/* PRIORITÉS */}
        <BentoItem size="side-tall" aria-label="Priorités">
          <AgencyPriorities
            priorites={priorites}
            loading={loading && !data && alertes.length === 0 && !issues}
            alertesIndisponibles={sourceErrors.alerts}
            problemesIndisponibles={sourceErrors.issues}
            avisATraiter={data?.feedbacks_a_traiter ?? 0}
            periode={`${jours} derniers jours`}
            onRetry={load}
          />
        </BentoItem>

        {/* ÉVOLUTION */}
        {data && (
          <BentoItem size="hero" aria-label="Évolution de la satisfaction">
            <AgencyEvolution points={data.tendances} periode={data.periode} />
          </BentoItem>
        )}

        {/* CE QUE DISENT LES CLIENTS */}
        {data && (
          <>
            <BentoItem size="half" aria-label="Ton des avis">
              <TonDesAvis sentiments={data.sentiments} />
            </BentoItem>
            <BentoItem size="half" aria-label="Thèmes des avis">
              <ThemesDesAvis themes={data.themes} jours={jours} />
            </BentoItem>
          </>
        )}

        {/* RECOMMANDATIONS */}
        <BentoItem size="full" aria-label="Recommandations">
          <AgencyRecommendations
            recos={recos}
            total={recosTotal}
            loadFailed={sourceErrors.recommendations}
            loading={loading}
            loadingMore={recosLoadingMore}
            actionsEnCours={data?.actions_ouvertes ?? 0}
            onMarquerTraitee={marquerTraitee}
            onLoadMore={loadMoreRecos}
            onRetry={load}
          />
        </BentoItem>

        {/* SUIVI DES PROBLÈMES */}
        <BentoItem size="full" aria-label="Suivi des problèmes">
          <AgencyProblemes snapshot={issues} failed={sourceErrors.issues} onRetry={load} />
        </BentoItem>
      </BentoGrid>
    </div>
  );
}

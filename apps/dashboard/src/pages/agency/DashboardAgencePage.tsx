/**
 * Dashboard d'agence (Agency Manager) — hiérarchie de lecture en 4 niveaux, un <h2> par groupe.
 * Toutes les données sont celles d'UNE seule agence (dashboardApi.agence, recommandationsApi.listAgence,
 * alertes filtrées par rôle côté API — voir verifier_acces_agence).
 *   Niveau 1  Situation de l'agence → « Comment va mon agence ? » (KPI + évolution de la satisfaction)
 *   Niveau 2  Urgent pour l'agence  → « Urgent » (alertes de seuil de satisfaction)
 *   Niveau 3  Compréhension         → « Que disent mes clients ? » (répartition des thèmes)
 *   Niveau 4  Action                → « Actions » (recommandations IA à traiter)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { dashboardApi, recommandationsApi, alertesApi, issuesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { DashboardAgence, Recommandation, Alerte, AlerteFeedback, Issue, IssueStatut } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import AgencyDecisionKpis from '../../components/agency/AgencyDecisionKpis';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import AlerteRow from '../../components/alerts/AlerteRow';
import RecommandationCard from '../../components/stats/RecommandationCard';
import { ArrowUpRightIcon } from '../../components/common/Icons';
import { themeLabel } from '../../utils/themeLabels';
import { GRAVITE_LABELS, PROBLEME_STATUT_LABELS } from '../../utils/vocabulaire';

const THEME_COLORS = [
  '#02302D', '#3C7730', '#75B72A', '#BCCF00', '#0284C7',
  '#DC2626', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4',
  '#10B981', '#6366F1', '#D97706', '#14B8A6', '#64748B',
];

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: '24px',
  padding: '24px 28px',
  border: '1px solid var(--color-border)',
  boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
};

const OPEN_ISSUE_STATUSES: IssueStatut[] = ['ouverte', 'action_en_cours', 'reouverte'];
const RESULT_ISSUE_STATUSES: IssueStatut[] = ['resolue', 'verifiee'];
const ISSUE_STATUSES: IssueStatut[] = [...OPEN_ISSUE_STATUSES, ...RESULT_ISSUE_STATUSES];
const ISSUE_LIMIT = 200;

type IssuesSnapshot = { items: Issue[]; totals: Record<IssueStatut, number>; truncated: boolean };

async function loadAgencyIssues(agenceId: string): Promise<IssuesSnapshot> {
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

function getPeriodVariation(points: DashboardAgence['tendances']) {
  const valid = points.filter((point) => Number.isFinite(point.taux));
  if (valid.length < 2) return null;
  return Math.round((valid[valid.length - 1].taux - valid[0].taux) * 10) / 10;
}

export default function DashboardAgencePage() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<DashboardAgence | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [feedbackAlerts, setFeedbackAlerts] = useState<AlerteFeedback[]>([]);
  const [issues, setIssues] = useState<IssuesSnapshot | null>(null);
  const [sourceErrors, setSourceErrors] = useState({ dashboard: false, recommendations: false, alerts: false, issues: false });
  const [recos, setRecos] = useState<Recommandation[]>([]);
  const [recosTotal, setRecosTotal] = useState(0);
  const [recosLoadingMore, setRecosLoadingMore] = useState(false);
  const [jours, setJours] = useState(30);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
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
        if (dashboard.status === 'fulfilled') setData(dashboard.value.data);
        else { console.error('Erreur chargement du dashboard agence:', dashboard.reason); setSourceErrors((current) => ({ ...current, dashboard: true })); }
        if (recommendations.status === 'fulfilled') {
          setRecos(recommendations.value.data ?? []);
          setRecosTotal(Number(recommendations.value.headers?.['x-total-count'] ?? recommendations.value.data?.length ?? 0));
        } else { setRecos([]); setRecosTotal(0); setSourceErrors((current) => ({ ...current, recommendations: true })); }
        if (alerts.status === 'fulfilled') {
          const response = alerts.value.data;
          setAlertes((response?.alertes_seuil ?? []).filter((item: Alerte) => item.agence_id === agenceId));
          setFeedbackAlerts((response?.alertes_feedback ?? []).filter((item: AlerteFeedback) => item.agence_id === agenceId));
        } else { setAlertes([]); setFeedbackAlerts([]); setSourceErrors((current) => ({ ...current, alerts: true })); }
        if (issuesResult.status === 'fulfilled') setIssues(issuesResult.value);
        else { setIssues(null); setSourceErrors((current) => ({ ...current, issues: true })); }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [agenceId, jours]);

  useEffect(() => {
    load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const marquerTraitee = async (id: string) => {
    try {
      await recommandationsApi.marquerTraitee(id);
      showToast('Recommandation marquée comme traitée');
      load();
    } catch {
      showToast('❌ Impossible d’enregistrer la modification. Réessayez.');
    }
  };

  const loadMoreRecos = async () => {
    if (!agenceId || recosLoadingMore || recos.length >= recosTotal) return;
    const requestId = requestIdRef.current;
    setRecosLoadingMore(true);
    try {
      const response = await recommandationsApi.listAgence(agenceId, { limit: 50, offset: recos.length });
      if (requestId === requestIdRef.current) setRecos((current) => [...current, ...(response.data || [])]);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        console.error('Erreur chargement des recommandations suivantes:', error);
        showToast('Impossible de charger les recommandations suivantes');
      }
    } finally {
      if (requestId === requestIdRef.current) setRecosLoadingMore(false);
    }
  };

  if (!agenceId) {
    return (
      <EmptyState
        title="Aucune agence rattachée à votre compte"
        message="Contactez votre CX Manager pour être rattaché à une agence."
        fullHeight
      />
    );
  }

  // Aucune donnée (échec du chargement) : la structure de la page n'est pas remplacée par un texte brut.
  const loadFailed = !loading && sourceErrors.dashboard && !data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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

      {/* ── En-tête avec sélecteur de période (toujours affiché, y compris pendant le chargement) ── */}
      <PageHeader
        greetingUser={user?.prenom}
        subtitle={`${data?.agence_nom || user?.agence_nom || 'Mon agence'} · ${data?.periode || `${jours} derniers jours`}`}
        showDateBesideActions
        onRefresh={load}
      >
        <div
          style={{
            display: 'flex',
            background: '#F1F5F2',
            padding: '3px',
            borderRadius: '12px',
            gap: '2px',
          }}
        >
          {[
            { v: 7, l: '7 jours' },
            { v: 30, l: '30 jours' },
            { v: 90, l: '90 jours' },
          ].map((item) => (
            <button
              key={item.v}
              onClick={() => setJours(item.v)}
              style={{
                background: jours === item.v ? '#FFFFFF' : 'transparent',
                color: jours === item.v ? '#02302D' : '#64748B',
                border: 'none',
                borderRadius: '9px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: jours === item.v ? 700 : 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
                boxShadow: jours === item.v ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {item.l}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Alertes éphémères (nouvelles alertes non vues — 15s) */}

      {loadFailed && (
        <>
          <EmptyState
            illustration="no-data"
            title="Impossible de charger les indicateurs de l’agence"
            message="Les priorités et recommandations disponibles restent consultables ci-dessous. Réessayez pour actualiser les indicateurs."
            action={{ label: 'Réessayer', onClick: load }}
          />
          <section aria-label="Données disponibles malgré l’erreur des indicateurs" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <SectionHeading>Sources disponibles</SectionHeading>
            {sourceErrors.alerts && <p role="status" style={{ margin: 0, color: 'var(--color-error)' }}>Alertes indisponibles.</p>}
            {alertes.map((item) => <AlerteRow key={item.agence_id} alerte={item} />)}
            {feedbackAlerts.map((item) => <div key={item.feedback_id} style={cardStyle}>Avis à examiner · note {item.note}/5{item.commentaire ? ` · ${item.commentaire}` : ''} <Link to="/feedbacks?tab=critiques">Voir les avis</Link></div>)}
            {sourceErrors.issues && <p role="status" style={{ margin: 0, color: 'var(--color-error)' }}>Problèmes à traiter indisponibles.</p>}
            {issues?.items.filter((issue) => OPEN_ISSUE_STATUSES.includes(issue.statut) && (issue.severite === 'critique' || issue.severite === 'elevee' || issue.necessite_action)).slice(0, 5).map((issue) => <div key={issue.id} style={cardStyle}><strong>{issue.titre}</strong> · {issue.severite} · {issue.statut} <Link to="/issues">Voir les problèmes</Link></div>)}
            {sourceErrors.recommendations && <p role="status" style={{ margin: 0, color: 'var(--color-error)' }}>Recommandations indisponibles.</p>}
            {recos.map((reco) => <RecommandationCard key={reco.id} recommandation={reco} onMarquerTraitee={marquerTraitee} />)}
          </section>
        </>
      )}

      {/* Squelette : reproduit la structure de la page pendant le premier chargement */}
      {!data && !loadFailed && (
        <div aria-busy="true" aria-label="Chargement du tableau de bord d'agence" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} height={84} radius="var(--radius-lg)" />
            ))}
          </div>
          <div style={cardStyle}>
            <SkeletonBlock width="40%" height={18} style={{ marginBottom: 20 }} />
            <SkeletonBlock height={230} radius="var(--radius-lg)" />
          </div>
          <div style={cardStyle}>
            <SkeletonBlock width="30%" height={18} style={{ marginBottom: 20 }} />
            <SkeletonBlock height={120} radius="var(--radius-lg)" />
          </div>
        </div>
      )}

      {/* Pendant une actualisation (changement de période), les données précédentes restent affichées, atténuées. */}
      {data && (
        <div
          aria-busy={loading}
          style={{ display: 'flex', flexDirection: 'column', gap: '28px', opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s ease' }}
        >
          {/* ── Niveau 1 : situation de l'agence ── */}
          <section aria-labelledby="agence-situation" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="agence-situation"><SectionHeading>Comment va mon agence ?</SectionHeading></div>

            <AgencyDecisionKpis data={data} jours={jours} />
            <p style={{ margin: '-8px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              La période choisie couvre les indicateurs, tendances et thèmes. Les priorités, problèmes à traiter et recommandations reflètent leur état actuel, toutes périodes confondues.
            </p>

            <section aria-labelledby="agence-priorites" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div id="agence-priorites"><SectionHeading>Priorités à traiter</SectionHeading></div>
              {sourceErrors.alerts && <p role="status" style={{ margin: 0, color: 'var(--color-error)', fontSize: '0.86rem' }}>Les alertes ne sont pas disponibles. Les autres priorités restent affichées.</p>}
              {sourceErrors.issues && <p role="status" style={{ margin: 0, color: 'var(--color-error)', fontSize: '0.86rem' }}>Les problèmes à traiter ne sont pas disponibles. Les autres priorités restent affichées.</p>}
              {!sourceErrors.alerts && alertes.map((al) => (
                <div key={al.agence_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 320px' }}><AlerteRow alerte={al} /></div>
                  <Link to="/statistiques" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.84rem', fontWeight: 700, color: '#3C7730', textDecoration: 'none' }}>
                    Analyser la tendance <ArrowUpRightIcon size={13} color="#3C7730" />
                  </Link>
                </div>
              ))}
              {!sourceErrors.alerts && feedbackAlerts.map((item) => (
                <div key={item.feedback_id} style={{ ...cardStyle, borderLeft: `5px solid ${item.note <= 2 ? 'var(--color-error)' : '#D97706'}`, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ display: 'block', color: 'var(--color-text-body)', fontSize: '0.9rem' }}>Avis à examiner · note {item.note}/5</strong>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>{item.categorie_nom || 'Catégorie non renseignée'} · {item.raison.replace(/_/g, ' ')}{item.commentaire ? ` · « ${item.commentaire} »` : ''}</span>
                  </div>
                  <Link to="/feedbacks?tab=critiques" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.84rem', fontWeight: 700, color: '#3C7730', textDecoration: 'none' }}>
                    Examiner les avis <ArrowUpRightIcon size={13} color="#3C7730" />
                  </Link>
                </div>
              ))}
              {!sourceErrors.issues && issues?.items
                .filter((issue) => OPEN_ISSUE_STATUSES.includes(issue.statut) && (issue.severite === 'critique' || issue.severite === 'elevee' || issue.necessite_action))
                .sort((a, b) => (a.severite === 'critique' ? 0 : a.severite === 'elevee' ? 1 : 2) - (b.severite === 'critique' ? 0 : b.severite === 'elevee' ? 1 : 2))
                .slice(0, 5)
                .map((issue) => (
                  <div key={issue.id} style={{ ...cardStyle, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', borderLeft: `5px solid ${issue.severite === 'critique' ? 'var(--color-error)' : '#D97706'}` }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ display: 'block', color: 'var(--color-text-body)', fontSize: '0.9rem' }}>{issue.titre}</strong>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>Gravité {(GRAVITE_LABELS[issue.severite] ?? issue.severite).toLowerCase()} · {PROBLEME_STATUT_LABELS[issue.statut] ?? issue.statut}{issue.categorie_nom ? ` · ${issue.categorie_nom}` : ''}</span>
                    </div>
                    <Link to="/issues" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.84rem', fontWeight: 700, color: '#3C7730', textDecoration: 'none' }}>
                      Voir les problèmes <ArrowUpRightIcon size={13} color="#3C7730" />
                    </Link>
                  </div>
                ))}
              {!sourceErrors.issues && issues?.truncated && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>Liste partielle : seuls les premiers problèmes sont chargés, {ISSUE_LIMIT} par statut.</p>}
              {!sourceErrors.alerts && !sourceErrors.issues && alertes.length === 0 && feedbackAlerts.length === 0 && (issues?.items.filter((issue) => OPEN_ISSUE_STATUSES.includes(issue.statut) && (issue.severite === 'critique' || issue.severite === 'elevee' || issue.necessite_action)).length ?? 0) === 0 && (
                <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Aucune alerte ni aucun problème prioritaire dans les données disponibles.</p>
              )}
              <Link to="/feedbacks?tab=a_traiter" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', alignSelf: 'flex-start', fontSize: '0.84rem', fontWeight: 700, color: '#3C7730', textDecoration: 'none' }}>
                Voir les {data.feedbacks_a_traiter} avis à traiter <ArrowUpRightIcon size={13} color="#3C7730" />
              </Link>
            </section>

            {/* Évolution de la satisfaction */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
                  Évolution de la satisfaction · {data.periode}
                </h3>
              </div>

              <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                {getPeriodVariation(data.tendances) === null
                  ? 'Variation indisponible : au moins deux relevés sont nécessaires.'
                  : `Variation du premier au dernier relevé de la période : ${getPeriodVariation(data.tendances)! > 0 ? '+' : ''}${getPeriodVariation(data.tendances)} points. Comparaison avec la période précédente non fournie par l’API.`}
              </p>

              {data.tendances.length > 0 ? <div style={{ width: '100%', height: 230 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.tendances}>
                    <defs>
                      <linearGradient id="gradAgence" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3C7730" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3C7730" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF2EC" />
                    <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v: number) => [`${v}%`, 'Satisfaction']} />
                    <Area
                      type="monotone"
                      dataKey="taux"
                      stroke="#3C7730"
                      strokeWidth={2.8}
                      fillOpacity={1}
                      fill="url(#gradAgence)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div> : <EmptyState illustration="no-data" title="Aucune donnée d’évolution" message={`Aucun relevé de satisfaction sur ${data.periode}.`} />}
            </div>
          </section>

          {/* ── Niveau 3 : compréhension ── */}
          <section aria-labelledby="agence-comprehension" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="agence-comprehension"><SectionHeading>Que disent mes clients ?</SectionHeading></div>
            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>Ton des avis</h3>
              {data.sentiments.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '12px' }}>
                  {[
                    { key: 'positif', label: 'Positif', color: '#3C7730', bg: '#EBF5E9' },
                    { key: 'neutre', label: 'Neutre', color: '#B45309', bg: '#FEF3C7' },
                    { key: 'negatif', label: 'Négatif', color: '#B91C1C', bg: '#FEE2E2' },
                  ].map((item) => {
                    const sentiment = data.sentiments.find((s) => s.sentiment === item.key);
                    const percentage = sentiment?.pourcentage;
                    return (
                      <div key={item.key} style={{ padding: '14px 16px', background: item.bg, borderRadius: '14px', color: item.color }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                          <strong style={{ fontSize: '0.84rem' }}>{item.label}</strong>
                          <strong style={{ fontSize: '1.1rem' }}>{percentage == null ? 'Aucune donnée' : `${percentage}%`}</strong>
                        </div>
                        <div style={{ marginTop: '5px', fontSize: '0.76rem', fontWeight: 600 }}>
                          {sentiment ? `${sentiment.count} avis analysés` : 'Aucun avis analysé'}
                        </div>
                        <div role="presentation" style={{ height: '5px', marginTop: '10px', background: 'rgba(255,255,255,0.75)', borderRadius: '999px', overflow: 'hidden' }}>
                          {percentage != null && <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, percentage))}%`, background: item.color, borderRadius: '999px' }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.86rem' }}>Les avis de cette période n’ont pas encore été analysés.</p>
              )}
            </div>
            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 18px', fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
                Répartition des thèmes
              </h3>
              {data.themes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                  {/* Donut */}
                  <div style={{ flex: '0 0 auto', width: '160px', height: '160px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.themes}
                          dataKey="count"
                          nameKey="theme"
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={70}
                          paddingAngle={3}
                        >
                          {data.themes.map((_, i) => (
                            <Cell key={i} fill={THEME_COLORS[i % THEME_COLORS.length]} stroke="#FFFFFF" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number, name: string) => [`${v} avis`, name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Légende : pastille + catégorie (choisie par le client) + pourcentage */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: '200px', maxHeight: '210px', overflowY: 'auto' }}>
                    {data.themes.map((t, i) => (
                      <Link
                        key={t.theme}
                        to={`/feedbacks?theme=${encodeURIComponent(t.theme)}`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '7px 10px', background: '#F8FAFC', borderRadius: '9px', textDecoration: 'none', minHeight: '36px' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: THEME_COLORS[i % THEME_COLORS.length],
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {themeLabel(t.theme)}
                          </span>
                        </div>
                        <strong style={{ fontSize: '0.8rem', color: '#02302D', flexShrink: 0 }}>{t.pourcentage}%</strong>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState
                  illustration="no-data"
                  title="Aucune donnée sur les thèmes"
                  message="Aucun avis analysé sur cette période."
                />
              )}
            </div>
          </section>

          {/* ── Niveau 4 : actions ── */}
          <section aria-labelledby="agence-actions" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="agence-actions"><SectionHeading>Que faire ?</SectionHeading></div>
            <div style={{ ...cardStyle, padding: '26px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '18px' }}>
                <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#02302D' }}>
                  Recommandations ({recosTotal})
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '0.84rem', color: '#64748B', fontWeight: 500 }}>
                  Pistes d’action suggérées automatiquement à partir des avis. Une recommandation n’est pas une décision : à vous de juger si elle s’applique.
                </p>
                </div>
                <Link
                  to="/actions"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.84rem', fontWeight: 700, color: '#3C7730', textDecoration: 'none' }}
                >
                  {data.actions_ouvertes} action{data.actions_ouvertes !== 1 ? 's' : ''} en cours
                  <ArrowUpRightIcon size={13} color="#3C7730" />
                </Link>
              </div>

              {sourceErrors.recommendations ? (
                <p role="status" style={{ margin: 0, color: 'var(--color-error)', fontSize: '0.86rem' }}>Impossible de charger les recommandations. Les autres données du tableau de bord restent disponibles.</p>
              ) : recos.length === 0 ? (
                <EmptyState
                  illustration="no-alert"
                  title="Aucune recommandation en attente"
                  message="Aucune recommandation à afficher pour le moment. Cela ne confirme pas la résolution des problèmes de l’agence."
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {recos.map((r) => (
                    <div key={r.id}>
                      <p style={{ margin: '0 0 6px', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>Statut : en attente · prochaine étape : examiner la recommandation puis la marquer comme traitée si elle a été prise en charge.</p>
                      <RecommandationCard recommandation={r} onMarquerTraitee={marquerTraitee} />
                    </div>
                  ))}
                  {recos.length < recosTotal && (
                    <button type="button" onClick={loadMoreRecos} disabled={recosLoadingMore} className="btn-secondary" style={{ alignSelf: 'center' }}>
                      {recosLoadingMore ? 'Chargement…' : `Charger plus (${recos.length}/${recosTotal})`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Résultats : le statut des issues est disponible, contrairement à une mesure d'impact post-intervention. */}
      {data && (
        <section aria-labelledby="agence-resultats" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div id="agence-resultats"><SectionHeading>Résultats et suivi</SectionHeading></div>
          {sourceErrors.issues || !issues ? (
            <p role="status" style={{ margin: 0, color: sourceErrors.issues ? 'var(--color-error)' : 'var(--color-text-muted)', fontSize: '0.86rem' }}>
              {sourceErrors.issues ? 'Le statut des problèmes est indisponible pour le moment.' : 'Chargement du statut des problèmes…'}
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: '12px' }}>
              {[
                { label: 'Problèmes encore à traiter', value: OPEN_ISSUE_STATUSES.reduce((total, statut) => total + issues.totals[statut], 0) },
                { label: 'Problèmes résolus', value: issues.totals.resolue },
                { label: 'Problèmes à résolution vérifiée', value: issues.totals.verifiee },
              ].map((metric) => (
                <div key={metric.label} style={{ ...cardStyle, padding: '16px 20px' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', fontWeight: 700 }}>{metric.label} · toutes périodes</div>
                  <div style={{ color: 'var(--color-text-body)', fontSize: '1.5rem', fontWeight: 800, marginTop: '4px' }}>{metric.value}</div>
                </div>
              ))}
            </div>
          )}
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
            « Résolu » et « Résolution vérifiée » sont des statuts déclarés par vos équipes : ils ne prouvent pas, à eux seuls, une amélioration de la satisfaction.
          </p>
        </section>
      )}
    </div>
  );
}

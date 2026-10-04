import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import type { AgenceRankDetail, Alerte, EvolutionPoint, StatsCXResponse } from '../../../types';
import Alert from '../../../components/ui/Alert';
import { BentoItem } from '../../../components/ui/BentoGrid';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Chart, { chartAxisProps, chartGridProps } from '../../../components/ui/Chart';
import EmptyState from '../../../components/ui/EmptyState';
import KpiCard from '../../../components/ui/KpiCard';
import Skeleton from '../../../components/ui/Skeleton';
import Tooltip from '../../../components/ui/Tooltip';
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  SmileIcon,
  StoreIcon,
} from '../../../components/common/Icons';
import { useYamStore } from '../../../stores/yamStore';
import {
  FAIBLE_VOLUME_POINT,
  RANG_CRITIQUE_MAX,
  REGLE_ALERTE_SEUIL_API,
  regleAlerteSeuilTexte,
  serieSparkline,
  MIN_AVIS_SEUIL,
  STATUT_SEUIL_LABEL,
  SURVEILLANCE,
  aggregateWeekly,
  compteDefavorableDelta,
  extremesWilson,
  granularitesDisponibles,
  isDailyPoint,
  satisfactionDelta,
  satisfactionTexte,
  sortEvolution,
  volumeDelta,
  type AgenceASurveiller,
  type Granularite,
  type KpiDelta,
  type RepartitionReseau,
  type StatutSeuil,
} from './siegeData';
import type { ActionsTotaux, IssuesOuvertes, Source } from './useSiegeData';

export type KpiKind = 'satisfaction' | 'volume' | 'critiques' | 'seuil';

/** Période de YAM (services/agent.ts) : les questions pré-remplies l'annoncent explicitement. */
export const YAM_PERIODE = '30 derniers jours';

const periodeLabel = (jours: number) => (jours === 365 ? '12 derniers mois' : `${jours} derniers jours`);
const toTrend = (d: KpiDelta | null, jours: number) =>
  d ? { value: d.text, isPositive: d.isPositive, direction: d.direction, period: `vs ${periodeLabel(jours)} précédents` } : undefined;

/** Lien d'en-tête de bloc vers la page dédiée (une destination = une fonction). */
export function BlockLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="siege-link">
      {children}
      <ArrowUpRightIcon size={13} aria-hidden="true" />
    </Link>
  );
}

/**
 * Entrée YAM contextuelle : la question est pré-remplie, jamais envoyée automatiquement.
 * Le nom d'agence éventuellement inclus dans `question` n'est qu'un texte : il ne
 * constitue JAMAIS une autorisation (dette technique, voir stores/yamStore.ts).
 */
export function AskYam({ question, label = 'Demander à YAM' }: { question: string; label?: string }) {
  const ask = useYamStore((s) => s.ask);
  return (
    <button type="button" className="ui-ai-chip" onClick={() => ask(question)}>
      <span className="ui-ai-chip__spark" aria-hidden="true">✦</span>
      {label}
    </button>
  );
}

function BlockError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert tone="warning" title={message} action={onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button> : undefined} />
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. SITUATION — 4 KPI (chacun dans sa case « kpi » de la grille bento)
// ════════════════════════════════════════════════════════════════════

export function SiegeKpis({
  stats,
  alertes,
  nbAgences,
  jours,
  onOpen,
}: {
  stats: Source<StatsCXResponse>;
  alertes: Source<Alerte[]>;
  nbAgences: number | null;
  jours: number;
  onOpen: (k: KpiKind) => void;
}) {
  const statsLoading = stats.status === 'loading';
  const k = stats.status === 'ok' ? stats.data.kpis : null;
  const volume = k?.total_feedbacks;
  const nbAvis = volume?.valeur_num ?? 0;
  const prevVolume = volume?.valeur_precedente ?? 0;
  const sansComparaison = 'Pas de comparaison : aucun avis sur la période précédente';

  const sparkline = useMemo(() => {
    if (stats.status !== 'ok') return undefined;
    return serieSparkline(stats.data.evolution_satisfaction);
  }, [stats]);

  const sat = satisfactionDelta(k?.satisfaction, volume);
  const vol = volumeDelta(volume);
  const crit = compteDefavorableDelta(k?.alertes_critiques, prevVolume);
  const nbCritiques = k?.alertes_critiques?.valeur_num ?? 0;
  const nbSousSeuil = alertes.status === 'ok' ? alertes.data.length : null;

  return (
    <>
      <BentoItem size="kpi" as="div">
      <KpiCard
        icon={<SmileIcon />}
        label="Satisfaction"
        hint="Part des avis notés 4 ou 5 sur 5 sur la période."
        loading={statsLoading}
        value={k ? satisfactionTexte(k.satisfaction?.valeur_num ?? 0, nbAvis) : '—'}
        tone={nbAvis === 0 ? 'neutral' : 'positive'}
        trend={toTrend(sat, jours)}
        subtitle={stats.status === 'error' ? 'Statistiques indisponibles' : k && !sat ? (nbAvis === 0 ? periodeLabel(jours) : sansComparaison) : undefined}
        sparkline={sparkline}
        highlight={nbAvis > 0}
        onClick={k ? () => onOpen('satisfaction') : undefined}
      />
      </BentoItem>
      <BentoItem size="kpi" as="div">
      <KpiCard
        icon={<MessageSquareIcon />}
        label="Feedbacks reçus"
        hint="Nombre d'avis clients reçus sur la période, toutes agences."
        loading={statsLoading}
        value={k ? nbAvis.toLocaleString('fr-FR') : '—'}
        tone="neutral"
        trend={toTrend(vol, jours)}
        subtitle={stats.status === 'error' ? 'Statistiques indisponibles' : k && !vol ? (nbAvis === 0 ? periodeLabel(jours) : sansComparaison) : undefined}
        onClick={k ? () => onOpen('volume') : undefined}
      />
      </BentoItem>
      <BentoItem size="kpi" as="div">
      <KpiCard
        icon={<AlertTriangleIcon />}
        label="Feedbacks critiques"
        hint="Feedbacks classés « critique » par l'analyse IA sur la période."
        loading={statsLoading}
        value={k ? nbCritiques.toLocaleString('fr-FR') : '—'}
        tone={nbCritiques > 0 ? 'critical' : 'neutral'}
        trend={toTrend(crit, jours)}
        subtitle={stats.status === 'error' ? 'Statistiques indisponibles' : k && !crit ? (prevVolume === 0 && nbAvis > 0 ? sansComparaison : periodeLabel(jours)) : undefined}
        onClick={k ? () => onOpen('critiques') : undefined}
      />
      </BentoItem>
      <BentoItem size="kpi" as="div">
      <KpiCard
        icon={<StoreIcon />}
        label="Agences sous leur seuil"
        hint={`Alertes actives : ${regleAlerteSeuilTexte()} C'est un état, pas une évolution.`}
        loading={alertes.status === 'loading'}
        value={nbSousSeuil == null ? '—' : String(nbSousSeuil)}
        tone={nbSousSeuil ? 'critical' : 'neutral'}
        subtitle={
          alertes.status === 'error'
            ? 'Alertes indisponibles'
            : `${nbAgences != null ? `sur ${nbAgences} agences · ` : ''}${REGLE_ALERTE_SEUIL_API.fenetreJours} derniers jours`
        }
        onClick={alertes.status === 'ok' ? () => onOpen('seuil') : undefined}
      />
      </BentoItem>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// 2. À SURVEILLER
// ════════════════════════════════════════════════════════════════════

const SIGNAL_TONE: Record<string, 'critical' | 'warning'> = { sous_seuil: 'critical', critiques: 'critical', baisse: 'warning', issues: 'warning' };
const SIGNAL_TITRE: Record<string, string> = {
  sous_seuil: 'Sous son seuil',
  critiques: 'Feedbacks critiques',
  baisse: 'Baisse importante',
  issues: 'Issues à traiter',
};

export function Surveillance({
  lignes,
  total,
  loading,
  sourcesIndisponibles,
  toutesIndisponibles,
  onRetry,
  onOpenAgence,
}: {
  lignes: AgenceASurveiller[];
  total: number;
  loading: boolean;
  sourcesIndisponibles: string[];
  /** Aucune source n'a pu être chargée : ne jamais afficher « aucun signal ». */
  toutesIndisponibles: boolean;
  onRetry: () => void;
  onOpenAgence: (id: string) => void;
}) {
  const regles = (
    <span>
      Une ligne par agence, triée par sa raison la plus prioritaire :
      <br />1. sous son seuil configuré (alerte active)
      <br />2. feedbacks critiques sur la période
      <br />3. baisse ≥ {SURVEILLANCE.BAISSE_MIN_PTS} pts vs période précédente (≥ {SURVEILLANCE.BAISSE_MIN_AVIS} avis)
      <br />4. Issues critiques ou élevées nécessitant une action
      <br />Seuils 3 et 4 provisoires. Aucun score composite.
    </span>
  );

  return (
    <Card
      title="À surveiller"
      subtitle={loading ? 'Analyse des signaux…' : lignes.length ? `${total} agence${total > 1 ? 's' : ''} présente${total > 1 ? 'nt' : ''} au moins un signal` : undefined}
      tone={lignes.some((l) => l.rang <= RANG_CRITIQUE_MAX) ? 'critical' : 'default'}
      className={`siege-surveillance${lignes.some((l) => l.rang === 1) ? ' has-critical' : ''}`}
      actions={
        <Tooltip content={regles} placement="bottom">
          <button type="button" className="ui-info-btn" aria-label="Comment cette liste est-elle priorisée ?">?</button>
        </Tooltip>
      }
      aria-busy={loading || undefined}
    >
      {loading ? (
        <div className="siege-rows">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={64} radius="var(--radius-md)" />)}
        </div>
      ) : toutesIndisponibles ? (
        <BlockError message="Impossible de vérifier les signaux pour le moment." onRetry={onRetry} />
      ) : lignes.length === 0 && sourcesIndisponibles.length > 0 ? (
        // Vérification partielle : pas de coche verte, l'absence de signal n'est pas garantie.
        <EmptyState compact illustration={null} title="Aucun signal dans les données vérifiées" message="Certaines sources n'ont pas pu être chargées (voir ci-dessous)." />
      ) : lignes.length === 0 ? (
        <EmptyState
          compact
          illustration="no-alert"
          title="Aucun signal prioritaire"
          message="Aucune agence sous son seuil, sans feedback critique, sans baisse importante ni Issue critique à traiter."
        />
      ) : (
        <ol className="siege-rows">
          {lignes.map((l) => (
            <li key={l.agence_id}>
              <button type="button" className="siege-row" onClick={() => onOpenAgence(l.agence_id)} aria-label={`${l.agence_nom} : ${l.signaux.map((s) => `${SIGNAL_TITRE[s.type]}, ${s.texte}`).join(' ; ')}. Ouvrir le détail`}>
                <span className="siege-row__main">
                  <span className="siege-row__title">
                    <span className={`siege-dot siege-dot--${SIGNAL_TONE[l.signaux[0].type]}`} aria-hidden="true" />
                    {l.agence_nom}
                  </span>
                  <span className="siege-row__signals">
                    {l.signaux.map((s) => (
                      <span key={s.type} className="siege-signal">
                        <Badge variant={SIGNAL_TONE[s.type]} label={SIGNAL_TITRE[s.type]} />
                        <span className="siege-signal__text">
                          {s.texte} <span className="siege-signal__scope">· {s.portee}</span>
                        </span>
                      </span>
                    ))}
                  </span>
                </span>
                <ChevronRightIcon size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="siege-foot">
        {total > lignes.length && <span className="siege-note">+{total - lignes.length} autre{total - lignes.length > 1 ? 's' : ''} agence{total - lignes.length > 1 ? 's' : ''} avec un signal</span>}
        {sourcesIndisponibles.length > 0 && <span className="siege-note">Non vérifié : {sourcesIndisponibles.join(', ')}</span>}
        <span className="siege-foot__actions">
          {lignes.length > 0 && <AskYam question={`Parmi les agences de mon réseau, lesquelles nécessitent une intervention prioritaire sur les ${YAM_PERIODE}, et pourquoi ?`} />}
          <BlockLink to="/alertes">Voir les alertes</BlockLink>
        </span>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// 3. ÉVOLUTION
// ════════════════════════════════════════════════════════════════════

function EvolutionTooltip({ active, payload }: { active?: boolean; payload?: { payload: EvolutionPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="ui-chart-tooltip">
      <p className="ui-chart-tooltip__label">{p.label}</p>
      <div className="ui-chart-tooltip__row">
        <span>Satisfaction</span>
        <span className="ui-chart-tooltip__value">{p.satisfaction.toLocaleString('fr-FR')} %</span>
      </div>
      <div className="ui-chart-tooltip__row">
        <span>Avis</span>
        <span className="ui-chart-tooltip__value">{p.feedbacks}</span>
      </div>
      {p.feedbacks < FAIBLE_VOLUME_POINT && <p className="siege-note" style={{ margin: 'var(--space-1) 0 0' }}>Faible volume : à interpréter avec prudence</p>}
    </div>
  );
}

/** Point de courbe : plein si volume suffisant, creux si faible volume (forme ≠ couleur seule). */
function EvolutionDot(props: { cx?: number; cy?: number; payload?: EvolutionPoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const faible = payload.feedbacks < FAIBLE_VOLUME_POINT;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={faible ? 3.5 : 4}
      fill={faible ? 'var(--color-surface)' : 'var(--dataviz-positive)'}
      stroke="var(--dataviz-positive)"
      strokeWidth={2}
    />
  );
}

export function Evolution({ stats, jours, onRetry }: { stats: Source<StatsCXResponse>; jours: number; onRetry: () => void }) {
  const options = granularitesDisponibles(jours);
  const [choix, setChoix] = useState<Granularite>('day');
  const granularite: Granularite = options.includes(choix) ? choix : options[0];

  const points = useMemo(() => {
    if (stats.status !== 'ok') return [];
    const base = sortEvolution(stats.data.evolution_satisfaction).filter((p) => p.feedbacks > 0);
    return granularite === 'week' && base.every(isDailyPoint) ? aggregateWeekly(base) : base;
  }, [stats, granularite]);

  const faibles = points.filter((p) => p.feedbacks < FAIBLE_VOLUME_POINT).length;

  return (
    <Chart
      title="Évolution de la satisfaction"
      subtitle={`${periodeLabel(jours)} · part des avis notés 4 ou 5${faibles ? ' · ○ point à faible volume (< ' + FAIBLE_VOLUME_POINT + ' avis)' : ''}`}
      loading={stats.status === 'loading'}
      error={stats.status === 'error' ? 'Les statistiques du réseau n’ont pas pu être chargées.' : undefined}
      onRetry={onRetry}
      isEmpty={stats.status === 'ok' && points.length === 0}
      emptyTitle="Aucun avis sur cette période."
      emptyMessage="La courbe apparaîtra dès les premiers avis. Élargissez la période pour voir l'historique."
      height={380}
      granularity={options.length > 1 && points.length > 0 ? { value: granularite, options, onChange: (g) => setChoix(g as Granularite) } : undefined}
      actions={<BlockLink to="/statistiques">Analyse détaillée</BlockLink>}
    >
      {() => (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="label" {...chartAxisProps} minTickGap={16} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v} %`} {...chartAxisProps} width={52} />
            <RTooltip content={<EvolutionTooltip />} cursor={{ stroke: 'var(--color-border-strong)' }} />
            <Line type="monotone" dataKey="satisfaction" name="Satisfaction" stroke="var(--dataviz-positive)" strokeWidth={2} dot={<EvolutionDot />} activeDot={{ r: 6 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Chart>
  );
}

// ════════════════════════════════════════════════════════════════════
// 4. RÉSEAU
// ════════════════════════════════════════════════════════════════════

const REPARTITION_ORDRE: StatutSeuil[] = ['sous', 'au_dessus', 'pas_assez_avis', 'sans_avis'];

function AgenceMiniRow({ a, onOpen }: { a: AgenceRankDetail; onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="siege-mini" onClick={() => onOpen(a.agence_id)}>
        <span className="siege-mini__name">{a.agence_nom}</span>
        <span className="siege-mini__value">{satisfactionTexte(a.satisfaction_rate, a.total_feedbacks)}</span>
        <span className="siege-mini__meta">{a.total_feedbacks} avis</span>
      </button>
    </li>
  );
}

export function Reseau({
  stats,
  repartition,
  seuilsDisponibles,
  jours,
  onOpenAgence,
  onRetry,
}: {
  stats: Source<StatsCXResponse>;
  repartition: RepartitionReseau | null;
  seuilsDisponibles: boolean;
  jours: number;
  onOpenAgence: (id: string) => void;
  onRetry: () => void;
}) {
  const extremes = stats.status === 'ok' ? extremesWilson(stats.data.agences_ranking) : null;
  const wilson = (
    <Tooltip content="Score Wilson — borne inférieure à 95 %. Classe les agences en tenant compte du nombre d'avis : 100 % sur 2 avis ne passe pas devant 90 % sur 200 avis.">
      <button type="button" className="ui-info-btn" aria-label="À propos du classement Wilson">?</button>
    </Tooltip>
  );

  return (
    <Card title="Réseau" subtitle={`${periodeLabel(jours)} · comparé au seuil configuré de chaque agence`} actions={<BlockLink to="/statistiques?tab=agences">Voir les agences</BlockLink>} aria-busy={stats.status === 'loading' || undefined}>
      {stats.status === 'loading' ? (
        <>
          <Skeleton height={14} radius="var(--radius-pill)" />
          <Skeleton variant="text" lines={3} />
        </>
      ) : stats.status === 'error' ? (
        <BlockError message="La synthèse du réseau est indisponible pour le moment." onRetry={onRetry} />
      ) : !repartition || repartition.total === 0 ? (
        <EmptyState compact title="Aucune agence active dans le réseau." />
      ) : (
        <>
          <div className="siege-distribution" aria-hidden="true">
            {REPARTITION_ORDRE.filter((s) => repartition[s] > 0).map((s) => (
              <span key={s} className={`siege-distribution__seg siege-distribution__seg--${s}`} style={{ flexGrow: repartition[s] }} />
            ))}
          </div>
          <ul className="siege-distribution__legend">
            {REPARTITION_ORDRE.map((s) => (
              <li key={s}>
                <span className={`siege-swatch siege-distribution__seg--${s}`} aria-hidden="true" />
                <strong>{repartition[s]}</strong> {STATUT_SEUIL_LABEL[s].toLowerCase()}
              </li>
            ))}
          </ul>
          {!seuilsDisponibles && <p className="siege-note">Seuils des agences indisponibles : statut calculé sans seuil.</p>}

          {extremes && extremes.comparables > 0 ? (
            <div className="siege-extremes">
              <section aria-labelledby="reseau-top">
                <h3 id="reseau-top" className="siege-subtitle">Mieux classées {wilson}</h3>
                <ol className="siege-mini-list">{extremes.meilleures.map((a) => <AgenceMiniRow key={a.agence_id} a={a} onOpen={onOpenAgence} />)}</ol>
              </section>
              {extremes.moinsBonnes.length > 0 && (
                <section aria-labelledby="reseau-flop">
                  <h3 id="reseau-flop" className="siege-subtitle">Moins bien classées</h3>
                  <ol className="siege-mini-list">{extremes.moinsBonnes.map((a) => <AgenceMiniRow key={a.agence_id} a={a} onOpen={onOpenAgence} />)}</ol>
                </section>
              )}
            </div>
          ) : (
            <p className="siege-note">Classement indisponible : aucune agence n'a au moins {MIN_AVIS_SEUIL} avis sur la période.</p>
          )}
        </>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// 5. POURQUOI ?
// ════════════════════════════════════════════════════════════════════

const SENTIMENT_LABEL: Record<string, string> = { positif: 'Plutôt positif', neutre: 'Plutôt neutre', negatif: 'Plutôt négatif' };

export function Pourquoi({ stats, jours, onRetry }: { stats: Source<StatsCXResponse>; jours: number; onRetry: () => void }) {
  const themes = stats.status === 'ok' ? stats.data.themes.slice(0, 3) : [];
  return (
    <Card title="Pourquoi ?" subtitle={`Thèmes les plus mentionnés · ${periodeLabel(jours)}`} actions={<BlockLink to="/statistiques?tab=thematiques">Analyse des thèmes</BlockLink>} aria-busy={stats.status === 'loading' || undefined}>
      {stats.status === 'loading' ? (
        <Skeleton variant="text" lines={3} />
      ) : stats.status === 'error' ? (
        <BlockError message="L'analyse des thèmes est indisponible pour le moment." onRetry={onRetry} />
      ) : themes.length === 0 ? (
        <EmptyState compact title="Aucun thème détecté sur cette période." message="Les thèmes apparaissent quand l'analyse IA des feedbacks est disponible." />
      ) : (
        <ol className="siege-themes">
          {themes.map((t, i) => (
            <li key={t.theme} className="siege-theme">
              <div className="siege-theme__head">
                <span className="siege-theme__rank" aria-hidden="true">{i + 1}</span>
                <span className="siege-theme__label">{t.label}</span>
                <span className="siege-theme__pct">{t.pourcentage.toLocaleString('fr-FR')} %</span>
              </div>
              <div className="siege-theme__meta">
                <span>{t.count} mention{t.count > 1 ? 's' : ''} · des retours analysés</span>
                <Badge value={t.sentiment_predominant} label={SENTIMENT_LABEL[t.sentiment_predominant] ?? t.sentiment_predominant} />
              </div>
              <AskYam label="Qu'en disent les clients ?" question={`Que disent les clients sur le thème « ${t.label} » sur les ${YAM_PERIODE} ? Donne des exemples représentatifs.`} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// 6. ACTION
// ════════════════════════════════════════════════════════════════════

export function Action({ actions, issues, onRetryActions, onRetryIssues }: { actions: Source<ActionsTotaux>; issues: Source<IssuesOuvertes>; onRetryActions: () => void; onRetryIssues: () => void }) {
  const issuesAction = issues.status === 'ok' ? issues.data.items.filter((i) => i.necessite_action).length : null;
  const stat = (label: string, value: React.ReactNode, link?: React.ReactNode) => (
    <div className="siege-stat">
      <span className="siege-stat__value">{value}</span>
      <span className="siege-stat__label">{label}</span>
      {link}
    </div>
  );
  return (
    // Portée explicite : l'API ne filtre pas les actions par date d'action, ces compteurs
    // ne suivent donc PAS le filtre de période (aucun filtrage simulé côté frontend).
    <Card
      title="Actions — toutes périodes"
      subtitle="Ces chiffres ne dépendent pas de la période sélectionnée en haut de page."
    >
      <div className="siege-stats">
        {actions.status === 'loading'
          ? <><Skeleton height={72} /><Skeleton height={72} /></>
          : actions.status === 'error'
            ? <BlockError message="Le suivi des actions est indisponible pour le moment." onRetry={onRetryActions} />
            : (
              <>
                {stat('Actions correctives en cours', actions.data.enCours.toLocaleString('fr-FR'), <BlockLink to="/actions">Voir les actions</BlockLink>)}
                {stat('Actions réalisées', actions.data.realisees.toLocaleString('fr-FR'))}
              </>
            )}
        {issues.status === 'loading'
          ? <Skeleton height={72} />
          : issues.status === 'error'
            ? <BlockError message="Les Issues sont indisponibles pour le moment." onRetry={onRetryIssues} />
            : stat(
                'Issues ouvertes nécessitant une action',
                `${issues.data.tronquee ? '≥ ' : ''}${issuesAction?.toLocaleString('fr-FR')}`,
                <BlockLink to="/issues">Voir les Issues</BlockLink>,
              )}
      </div>
    </Card>
  );
}

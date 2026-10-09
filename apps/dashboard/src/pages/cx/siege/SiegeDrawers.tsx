import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { statisticsApi } from '../../../services/api';
import type { Agence, AgenceRankDetail, Alerte, StatsCXResponse } from '../../../types';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import DataTable, { type DataTableColumn } from '../../../components/ui/DataTable';
import KpiCard from '../../../components/ui/KpiCard';
import Skeleton from '../../../components/ui/Skeleton';
import { AlertTriangleIcon, SmileIcon } from '../../../components/common/Icons';
import {
  STATUT_SEUIL_LABEL,
  RANG_CRITIQUE_MAX,
  regleAlerteSeuilTexte,
  serieSparkline,
  compteDefavorableDelta,
  satisfactionDelta,
  satisfactionTexte,
  statutSeuil,
  type AgenceASurveiller,
  type StatutSeuil,
} from './siegeData';
import { fetchActionsTotaux, fetchIssuesOuvertes, type ActionsTotaux, type IssuesOuvertes } from './useSiegeData';
import { AskYam, BlockLink, YAM_PERIODE, type KpiKind } from './SiegeBlocks';

const STATUT_TONE: Record<StatutSeuil, 'success' | 'critical' | 'neutral' | 'outline'> = {
  au_dessus: 'success',
  sous: 'critical',
  pas_assez_avis: 'neutral',
  sans_avis: 'outline',
};

export const KPI_TITRE: Record<KpiKind, string> = {
  satisfaction: 'Satisfaction par agence',
  volume: 'Avis par agence',
  critiques: 'Avis critiques par agence',
  seuil: 'Agences sous leur seuil',
};

// ════════════════════════════════════════════════════════════════════
// Détail d'un KPI : répartition par agence (clic → détail agence)
// ════════════════════════════════════════════════════════════════════

export function KpiDetail({
  kind,
  ranking,
  alertes,
  seuils,
  jours,
  onOpenAgence,
}: {
  kind: KpiKind;
  ranking: AgenceRankDetail[];
  alertes: Alerte[];
  seuils: Map<string, number>;
  jours: number;
  onOpenAgence: (id: string) => void;
}) {
  const navigate = useNavigate();
  const statutCol: DataTableColumn<AgenceRankDetail> = {
    key: 'statut',
    header: 'Statut',
    render: (a) => {
      const s = statutSeuil(a.satisfaction_rate, a.total_feedbacks, seuils.get(a.agence_id));
      return <Badge variant={STATUT_TONE[s]} label={STATUT_SEUIL_LABEL[s]} />;
    },
  };
  const nomCol: DataTableColumn<AgenceRankDetail> = { key: 'agence_nom', header: 'Agence', sortValue: (a) => a.agence_nom };

  if (kind === 'seuil') {
    return (
      <>
        <p className="siege-note">Alertes actives : {regleAlerteSeuilTexte()}</p>
        <DataTable<Alerte>
          caption="Agences sous leur seuil"
          rows={alertes}
          rowKey={(a) => a.agence_id}
          onRowClick={(a) => onOpenAgence(a.agence_id)}
          rowLabel={(a) => `Ouvrir le détail de ${a.agence_nom}`}
          emptyTitle="Aucune agence sous son seuil."
          columns={[
            { key: 'agence_nom', header: 'Agence' },
            { key: 'taux_actuel', header: 'Satisfaction', align: 'right', numeric: true, render: (a) => `${a.taux_actuel} %` },
            { key: 'seuil', header: 'Seuil', align: 'right', numeric: true, render: (a) => `${a.seuil} %` },
          ]}
        />
        <div className="siege-drawer-actions"><Button variant="secondary" onClick={() => navigate('/alertes')}>Voir les alertes</Button></div>
      </>
    );
  }

  const columns: DataTableColumn<AgenceRankDetail>[] =
    kind === 'satisfaction'
      ? [
          nomCol,
          {
            key: 'sat',
            header: 'Satisfaction',
            align: 'right',
            numeric: true,
            // Agences sans avis triées en fin de liste (sortValue null), jamais comme « 0 % ».
            sortValue: (a) => (a.total_feedbacks ? a.satisfaction_rate : null),
            render: (a) => satisfactionTexte(a.satisfaction_rate, a.total_feedbacks),
          },
          { key: 'avis', header: 'Avis', align: 'right', numeric: true, sortValue: (a) => a.total_feedbacks, render: (a) => a.total_feedbacks },
          statutCol,
        ]
      : kind === 'volume'
        ? [
            nomCol,
            { key: 'avis', header: 'Avis', align: 'right', numeric: true, sortValue: (a) => a.total_feedbacks, render: (a) => a.total_feedbacks },
            { key: 'traites', header: 'Pris en charge', align: 'right', numeric: true, sortValue: (a) => a.feedbacks_traites, render: (a) => a.feedbacks_traites },
          ]
        : [
            nomCol,
            { key: 'crit', header: 'Critiques', align: 'right', numeric: true, sortValue: (a) => a.alertes_critiques, render: (a) => a.alertes_critiques },
            { key: 'avis', header: 'Avis', align: 'right', numeric: true, sortValue: (a) => a.total_feedbacks, render: (a) => a.total_feedbacks },
          ];

  const rows = kind === 'critiques' ? ranking.filter((a) => a.alertes_critiques > 0) : ranking;
  const defaultSort =
    kind === 'satisfaction' ? { key: 'sat', direction: 'asc' as const } : kind === 'volume' ? { key: 'avis', direction: 'desc' as const } : { key: 'crit', direction: 'desc' as const };

  return (
    <>
      <p className="siege-note">{jours === 365 ? '12 derniers mois' : `${jours} derniers jours`} · cliquez sur une agence pour son détail.</p>
      <DataTable<AgenceRankDetail>
        caption={KPI_TITRE[kind]}
        rows={rows}
        rowKey={(a) => a.agence_id}
        onRowClick={(a) => onOpenAgence(a.agence_id)}
        rowLabel={(a) => `Ouvrir le détail de ${a.agence_nom}`}
        defaultSort={defaultSort}
        emptyTitle={kind === 'critiques' ? 'Aucun avis critique sur cette période.' : 'Aucune agence.'}
        columns={columns}
      />
      <div className="siege-drawer-actions">
        {kind === 'satisfaction' ? (
          <Button variant="secondary" onClick={() => navigate('/statistiques')}>Analyse détaillée</Button>
        ) : (
          <Button variant="secondary" onClick={() => navigate('/feedbacks')}>Voir les avis</Button>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Détail d'une agence : 5 blocs maximum, puis « Voir l'agence »
// ════════════════════════════════════════════════════════════════════

type Etat<T> = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

function useAgenceDetail(agenceId: string, jours: number) {
  const [stats, setStats] = useState<Etat<StatsCXResponse>>({ status: 'loading' });
  const [issues, setIssues] = useState<Etat<IssuesOuvertes>>({ status: 'loading' });
  const [actions, setActions] = useState<Etat<ActionsTotaux>>({ status: 'loading' });
  useEffect(() => {
    let off = false;
    setStats({ status: 'loading' });
    setIssues({ status: 'loading' });
    setActions({ status: 'loading' });
    statisticsApi.cx({ jours, agence_id: agenceId }).then((r) => !off && setStats({ status: 'ok', data: r.data })).catch(() => !off && setStats({ status: 'error' }));
    fetchIssuesOuvertes(agenceId).then((d) => !off && setIssues({ status: 'ok', data: d })).catch(() => !off && setIssues({ status: 'error' }));
    fetchActionsTotaux(agenceId).then((d) => !off && setActions({ status: 'ok', data: d })).catch(() => !off && setActions({ status: 'error' }));
    return () => { off = true; };
  }, [agenceId, jours]);
  return { stats, issues, actions };
}

export function AgenceDetail({
  agenceId,
  agenceNom,
  agence,
  surveillance,
  jours,
}: {
  agenceId: string;
  agenceNom: string;
  agence?: Agence;
  surveillance?: AgenceASurveiller;
  jours: number;
}) {
  const navigate = useNavigate();
  const { stats, issues, actions } = useAgenceDetail(agenceId, jours);
  const k = stats.status === 'ok' ? stats.data.kpis : null;
  const avis = k?.total_feedbacks?.valeur_num ?? 0;
  const prevAvis = k?.total_feedbacks?.valeur_precedente ?? 0;
  const sat = satisfactionDelta(k?.satisfaction, k?.total_feedbacks);
  const crit = compteDefavorableDelta(k?.alertes_critiques, prevAvis);
  const statut = k ? statutSeuil(k.satisfaction?.valeur_num ?? null, avis, agence?.seuil_alerte) : null;
  const theme = stats.status === 'ok' ? stats.data.themes[0] : undefined;
  const sparkline = useMemo(() => {
    if (stats.status !== 'ok') return undefined;
    return serieSparkline(stats.data.evolution_satisfaction);
  }, [stats]);
  const periode = jours === 365 ? '12 derniers mois' : `${jours} derniers jours`;
  const issuesAction = issues.status === 'ok' ? issues.data.items.filter((i) => i.necessite_action).length : null;

  return (
    <div className="siege-drawer">
      {/* 1. Pourquoi cette agence est signalée (signaux calculés, pas d'interprétation) */}
      {surveillance && (
        <Alert tone={surveillance.rang <= RANG_CRITIQUE_MAX ? 'critical' : 'warning'} title="Signalée dans « À surveiller »">
          <ul className="siege-drawer__signals">
            {surveillance.signaux.map((s) => <li key={s.type}>{s.texte} <span className="siege-signal__scope">· {s.portee}</span></li>)}
          </ul>
        </Alert>
      )}

      {stats.status === 'error' ? (
        <Alert tone="warning" title="Les statistiques de cette agence n'ont pas pu être chargées." />
      ) : (
        <div className="siege-drawer__kpis">
          {/* 2. Satisfaction + évolution */}
          <KpiCard
            compact
            icon={<SmileIcon />}
            label="Satisfaction"
            loading={stats.status === 'loading'}
            value={k ? satisfactionTexte(k.satisfaction?.valeur_num ?? null, avis) : '—'}
            tone={statut === 'sous' ? 'critical' : avis ? 'positive' : 'neutral'}
            trend={sat ? { value: sat.text, isPositive: sat.isPositive, direction: sat.direction, period: 'vs période précédente' } : undefined}
            subtitle={k ? `${avis} avis · ${periode}` : undefined}
            sparkline={sparkline}
          />
          {/* 3. Feedbacks critiques */}
          <KpiCard
            compact
            icon={<AlertTriangleIcon />}
            label="Avis critiques"
            loading={stats.status === 'loading'}
            value={k ? String(k.alertes_critiques?.valeur_num ?? 0) : '—'}
            tone={(k?.alertes_critiques?.valeur_num ?? 0) > 0 ? 'critical' : 'neutral'}
            trend={crit ? { value: crit.text, isPositive: crit.isPositive, direction: crit.direction, period: 'vs période précédente' } : undefined}
            subtitle={periode}
          />
        </div>
      )}
      {statut && agence && (
        <p className="siege-note">
          Statut : <strong>{STATUT_SEUIL_LABEL[statut]}</strong>
          {statut !== 'sans_avis' && ` (seuil configuré : ${agence.seuil_alerte} %)`}
        </p>
      )}

      {/* 4. Thème principal */}
      <section className="siege-drawer__block" aria-labelledby="drawer-theme">
        <h3 id="drawer-theme" className="siege-subtitle">Thème principal</h3>
        {stats.status === 'loading' ? (
          <Skeleton variant="text" />
        ) : theme ? (
          <p className="siege-drawer__line">
            <strong>{theme.label}</strong> — {theme.pourcentage.toLocaleString('fr-FR')} % des avis analysés ({theme.count} mention{theme.count > 1 ? 's' : ''})
          </p>
        ) : (
          <p className="siege-note">Aucun thème détecté sur la période.</p>
        )}
      </section>

      {/* 5. Issues et actions ouvertes */}
      <section className="siege-drawer__block" aria-labelledby="drawer-suivi">
        <h3 id="drawer-suivi" className="siege-subtitle">Suivi en cours — toutes périodes</h3>
        <ul className="siege-drawer__list">
          <li>
            {issues.status === 'loading' ? <Skeleton variant="text" width={180} /> : issues.status === 'error' ? 'Problèmes à traiter indisponibles' : (
              <><strong>{issues.data.tronquee ? '≥ ' : ''}{issuesAction}</strong> problème{issuesAction !== 1 ? 's' : ''} en cours nécessitant une action</>
            )}
          </li>
          <li>
            {actions.status === 'loading' ? <Skeleton variant="text" width={160} /> : actions.status === 'error' ? 'Actions indisponibles' : (
              <><strong>{actions.data.enCours}</strong> action{actions.data.enCours !== 1 ? 's' : ''} corrective{actions.data.enCours !== 1 ? 's' : ''} en cours</>
            )}
          </li>
        </ul>
      </section>

      <div className="siege-drawer-actions">
        <Button onClick={() => navigate(`/agences/${agenceId}/apercu`)}>Voir l'agence</Button>
        <AskYam question={`Pourquoi la satisfaction de l'agence ${agenceNom} évolue-t-elle ainsi sur les ${YAM_PERIODE}, et quelles actions recommandes-tu ?`} />
        <BlockLink to="/issues">Voir les problèmes</BlockLink>
      </div>
    </div>
  );
}

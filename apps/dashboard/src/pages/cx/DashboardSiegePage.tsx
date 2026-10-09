/**
 * Dashboard CX Manager — Decision Workspace (étape 4).
 *
 * « En 10 secondes : savoir s'il faut agir. En 30 secondes : comprendre pourquoi. »
 * Ordre validé (= ordre du DOM = ordre de lecture clavier/mobile) :
 *   SITUATION → À SURVEILLER → ÉVOLUTION → RÉSEAU → POURQUOI ? → ACTION
 *
 * C'est une SYNTHÈSE : chaque bloc renvoie vers sa page dédiée (Alertes, Issues,
 * Actions, Performance…) au lieu de la reproduire. Le détail rapide s'ouvre en
 * panneau latéral (KPI → agences → agence) sans quitter la page.
 *
 * Sources (aucune donnée simulée) :
 *   GET /dashboard/statistics/cx  KPI + comparaison, évolution, thèmes, classement
 *   GET /alertes                  agences sous leur seuil (état, 7 jours glissants)
 *   GET /agences/                 seuil configuré de chaque agence
 *   GET /issues/ (statuts ouverts)
 *   GET /feedbacks/?avec_action   totaux des actions correctives
 * Transformations et seuils provisoires : ./siege/siegeData.ts
 */
import React, { useMemo, useState } from 'react';
import Drawer from '../../components/ui/Drawer';
import IconButton from '../../components/ui/IconButton';
import PageTitle from '../../components/ui/PageTitle';
import { BentoGrid, BentoItem } from '../../components/ui/BentoGrid';
import { RefreshIcon } from '../../components/common/Icons';
import { buildSurveillance, repartitionReseau } from './siege/siegeData';
import { useSiegeData } from './siege/useSiegeData';
import { Action, Evolution, Pourquoi, Reseau, SiegeKpis, Surveillance, type KpiKind } from './siege/SiegeBlocks';
import { AgenceDetail, KPI_TITRE, KpiDetail } from './siege/SiegeDrawers';

const PERIODES = [
  { v: 7, l: '7 jours' },
  { v: 30, l: '30 jours' },
  { v: 90, l: '90 jours' },
  { v: 365, l: '12 mois' },
];

type DrawerView = { type: 'kpi'; kind: KpiKind } | { type: 'agence'; id: string };

export default function DashboardSiegePage() {
  const [jours, setJours] = useState(30);
  const data = useSiegeData(jours);
  const { stats, alertes, agences, issues, actions } = data;

  // Pile du panneau latéral : KPI → agence, avec retour au niveau précédent.
  const [drawer, setDrawer] = useState<DrawerView[]>([]);
  const openKpi = (kind: KpiKind) => setDrawer([{ type: 'kpi', kind }]);
  const openAgence = (id: string) => setDrawer((pile) => [...pile, { type: 'agence', id }]);
  const closeDrawer = () => setDrawer([]);

  const ranking = stats.status === 'ok' ? stats.data.agences_ranking : [];
  const agencesMeta = useMemo(() => new Map((agences.status === 'ok' ? agences.data : []).map((a) => [a.id, a])), [agences]);
  const seuils = useMemo(() => new Map([...agencesMeta].map(([id, a]) => [id, a.seuil_alerte])), [agencesMeta]);

  // « À surveiller » : calculée dès que les statistiques sont là ; une source manquante est signalée, pas masquée.
  const surveillanceLoading = stats.status === 'loading' || alertes.status === 'loading' || issues.status === 'loading';
  const surveillance = useMemo(
    () =>
      buildSurveillance({
        ranking,
        alertesSeuil: alertes.status === 'ok' ? alertes.data : [],
        issuesOuvertes: issues.status === 'ok' ? issues.data.items : [],
        jours,
      }),
    [ranking, alertes, issues, jours],
  );
  const sourcesIndisponibles = [
    stats.status === 'error' && 'avis critiques et baisses',
    alertes.status === 'error' && 'seuils (alertes)',
    issues.status === 'error' && 'problèmes à traiter',
  ].filter(Boolean) as string[];

  const repartition = stats.status === 'ok' ? repartitionReseau(ranking, seuils) : null;

  const vue = drawer[drawer.length - 1];
  const agenceVue = vue?.type === 'agence' ? ranking.find((a) => a.agence_id === vue.id) ?? null : null;
  const agenceNom = vue?.type === 'agence' ? agenceVue?.agence_nom ?? agencesMeta.get(vue.id)?.nom ?? (alertes.status === 'ok' ? alertes.data.find((a) => a.agence_id === vue.id)?.agence_nom : undefined) ?? 'Agence' : '';

  return (
    <div className="siege">
      <PageTitle
        title="Vue réseau"
        description="Faut-il agir ? Situation, priorités et tendances de votre réseau."
        actions={
          <>
            <div className="ui-segmented" role="group" aria-label="Période">
              {PERIODES.map((p) => (
                <button key={p.v} type="button" className="ui-segmented__item" aria-pressed={jours === p.v} onClick={() => setJours(p.v)}>
                  {p.l}
                </button>
              ))}
            </div>
            <IconButton label="Actualiser les données" icon={<RefreshIcon size={16} />} onClick={data.reloadAll} />
          </>
        }
      />

      <BentoGrid>
        {/* SITUATION */}
        <SiegeKpis stats={stats} alertes={alertes} nbAgences={stats.status === 'ok' ? ranking.length : agences.status === 'ok' ? agences.data.length : null} jours={jours} onOpen={openKpi} />

        {/* À SURVEILLER — immédiatement après les KPI (décision validée) */}
        <BentoItem size="side-tall" aria-label="À surveiller">
          <Surveillance
            lignes={surveillance.lignes}
            total={surveillance.total}
            loading={surveillanceLoading}
            sourcesIndisponibles={sourcesIndisponibles}
            toutesIndisponibles={sourcesIndisponibles.length === 3}
            onRetry={data.reloadAll}
            onOpenAgence={openAgence}
          />
        </BentoItem>

        {/* ÉVOLUTION */}
        <BentoItem size="hero" aria-label="Évolution">
          <Evolution stats={stats} jours={jours} onRetry={data.reloadStats} />
        </BentoItem>

        {/* RÉSEAU */}
        <BentoItem size="two-thirds" aria-label="Réseau">
          <Reseau stats={stats} repartition={repartition} seuilsDisponibles={agences.status === 'ok'} jours={jours} onOpenAgence={openAgence} onRetry={data.reloadStats} />
        </BentoItem>

        {/* POURQUOI ? */}
        <BentoItem size="third" span={{ md: 12 }} aria-label="Pourquoi">
          <Pourquoi stats={stats} jours={jours} onRetry={data.reloadStats} />
        </BentoItem>

        {/* ACTION */}
        <BentoItem size="full" aria-label="Action">
          <Action actions={actions} issues={issues} onRetryActions={data.reloadActions} onRetryIssues={data.reloadIssues} />
        </BentoItem>
      </BentoGrid>

      <Drawer
        open={drawer.length > 0}
        onClose={closeDrawer}
        onBack={drawer.length > 1 ? () => setDrawer((pile) => pile.slice(0, -1)) : undefined}
        backLabel="Retour au niveau précédent"
        title={vue?.type === 'kpi' ? KPI_TITRE[vue.kind] : agenceNom}
        subtitle={vue?.type === 'agence' ? agenceVue?.ville ?? agencesMeta.get(vue.id)?.ville ?? undefined : undefined}
      >
        {vue?.type === 'kpi' && (
          <KpiDetail
            kind={vue.kind}
            ranking={ranking}
            alertes={alertes.status === 'ok' ? alertes.data : []}
            seuils={seuils}
            jours={jours}
            onOpenAgence={openAgence}
          />
        )}
        {vue?.type === 'agence' && (
          <AgenceDetail
            key={vue.id}
            agenceId={vue.id}
            agenceNom={agenceNom}
            agence={agencesMeta.get(vue.id)}
            surveillance={surveillance.lignes.find((l) => l.agence_id === vue.id)}
            jours={jours}
          />
        )}
      </Drawer>
    </div>
  );
}


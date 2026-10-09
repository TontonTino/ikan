import React from 'react';
import type { DashboardAgence } from '../../types';
import KpiCard from '../ui/KpiCard';
import { AlertTriangleIcon, CheckCircleIcon, MessageSquareIcon, SmileIcon } from '../common/Icons';

type Props = {
  data: DashboardAgence;
  jours: number;
};

export default function AgencyDecisionKpis({ data, jours }: Props) {
  const noFeedbacks = data.nombre_feedbacks === 0 || data.taux_satisfaction == null;

  return (
    <div
      aria-label="Indicateurs clés de mon agence"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: '12px' }}
    >
      <KpiCard
        compact
        showSparkline={false}
        icon={<SmileIcon size={16} />}
        label="Satisfaction"
        hint="Part des avis notés 4 ou 5 sur 5 sur la période."
        value={noFeedbacks ? 'Aucune donnée' : `${data.taux_satisfaction}%`}
        subtitle={noFeedbacks ? 'sur cette période' : `sur ${data.nombre_feedbacks} avis`}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<MessageSquareIcon size={16} />}
        label="Avis clients"
        value={data.nombre_feedbacks}
        subtitle={`${jours} derniers jours · ${data.nombre_negatifs} négatif${data.nombre_negatifs !== 1 ? 's' : ''}`}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<AlertTriangleIcon size={16} />}
        label="Avis critiques"
        value={data.nombre_critiques}
        subtitle={`sur les ${jours} derniers jours`}
        tone={data.nombre_critiques > 0 ? 'critical' : 'neutral'}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<AlertTriangleIcon size={16} />}
        label="Avis à traiter"
        value={data.feedbacks_a_traiter}
        subtitle={`${data.actions_ouvertes} action${data.actions_ouvertes !== 1 ? 's' : ''} à mener en cours`}
        badgeColor={data.feedbacks_a_traiter > 0 ? 'red' : 'green'}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<CheckCircleIcon size={16} />}
        label="Prise en charge"
        value={data.taux_prise_en_charge === null ? 'Aucune donnée' : `${data.taux_prise_en_charge}%`}
        subtitle="avis ayant quitté le statut Nouveau"
      />
    </div>
  );
}

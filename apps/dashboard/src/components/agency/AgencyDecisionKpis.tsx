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
        value={noFeedbacks ? 'Pas de données' : `${data.taux_satisfaction}%`}
        subtitle={noFeedbacks ? 'sur cette période' : `sur ${data.nombre_feedbacks} feedbacks`}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<MessageSquareIcon size={16} />}
        label="Feedbacks"
        value={data.nombre_feedbacks}
        subtitle={`${jours} derniers jours · ${data.nombre_negatifs} négatif${data.nombre_negatifs !== 1 ? 's' : ''}`}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<AlertTriangleIcon size={16} />}
        label="Feedbacks critiques"
        value={data.nombre_critiques}
        subtitle={`sur les ${jours} derniers jours`}
        tone={data.nombre_critiques > 0 ? 'critical' : 'neutral'}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<AlertTriangleIcon size={16} />}
        label="À traiter"
        value={data.feedbacks_a_traiter}
        subtitle={`${data.actions_ouvertes} action${data.actions_ouvertes !== 1 ? 's' : ''} corrective${data.actions_ouvertes !== 1 ? 's' : ''} ouverte${data.actions_ouvertes !== 1 ? 's' : ''}`}
        badgeColor={data.feedbacks_a_traiter > 0 ? 'red' : 'green'}
      />
      <KpiCard
        compact
        showSparkline={false}
        icon={<CheckCircleIcon size={16} />}
        label="Prise en charge"
        value={data.taux_prise_en_charge === null ? 'Pas de données' : `${data.taux_prise_en_charge}%`}
        subtitle="feedbacks ayant quitté le statut Nouveau"
      />
    </div>
  );
}

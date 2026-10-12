import React from 'react';
import type { DashboardAgence } from '../../types';
import KpiCard from '../ui/KpiCard';
import { BentoItem } from '../ui/BentoGrid';
import { AlertTriangleIcon, ClockIcon, MessageSquareIcon, SmileIcon } from '../common/Icons';

type Props = {
  data: DashboardAgence;
  jours: number;
};

const pluriel = (n: number, mot: string) => `${n} ${mot}${n !== 1 ? 's' : ''}`;

/**
 * Situation de l'agence : quatre indicateurs, chacun avec sa valeur réelle et sa période.
 * Aucune comparaison avec la période précédente : l'API de l'agence ne la fournit pas.
 * Rendus comme cases de la grille « bento » (même composition que la vue réseau du CX Manager).
 */
export default function AgencyDecisionKpis({ data, jours }: Props) {
  const sansAvis = data.nombre_feedbacks === 0 || data.taux_satisfaction == null;
  const priseEnCharge = data.taux_prise_en_charge === null ? 'prise en charge : aucune donnée' : `${data.taux_prise_en_charge} % pris en charge`;

  return (
    <>
      <BentoItem size="kpi" as="div">
        <KpiCard
          icon={<SmileIcon />}
          label="Satisfaction"
          hint="Part des avis notés 4 ou 5 sur 5 sur la période."
          value={sansAvis ? 'Aucune donnée' : `${data.taux_satisfaction} %`}
          tone={sansAvis ? 'neutral' : 'positive'}
          highlight={!sansAvis}
          subtitle={sansAvis ? `aucun avis sur les ${jours} derniers jours` : `sur ${pluriel(data.nombre_feedbacks, 'avis')} · ${jours} derniers jours`}
        />
      </BentoItem>
      <BentoItem size="kpi" as="div">
        <KpiCard
          icon={<MessageSquareIcon />}
          label="Avis reçus"
          hint="Nombre d’avis reçus par l’agence sur la période."
          value={data.nombre_feedbacks.toLocaleString('fr-FR')}
          tone="neutral"
          subtitle={`${jours} derniers jours · ${pluriel(data.nombre_negatifs, 'négatif')}`}
        />
      </BentoItem>
      <BentoItem size="kpi" as="div">
        <KpiCard
          icon={<AlertTriangleIcon />}
          label="Avis critiques"
          hint="Avis dont la gravité, calculée automatiquement, est « critique » sur la période."
          value={data.nombre_critiques.toLocaleString('fr-FR')}
          tone={data.nombre_critiques > 0 ? 'critical' : 'neutral'}
          subtitle={`${jours} derniers jours`}
        />
      </BentoItem>
      <BentoItem size="kpi" as="div">
        <KpiCard
          icon={<ClockIcon />}
          label="Avis à traiter"
          hint="Avis reçus sur la période qui ne sont pas résolus, ou dont la demande de rappel n’est pas encore traitée. La prise en charge est la part des avis de la période qui ont quitté le statut Nouveau."
          value={data.feedbacks_a_traiter.toLocaleString('fr-FR')}
          tone={data.feedbacks_a_traiter > 0 ? 'warning' : 'positive'}
          subtitle={`${jours} derniers jours · ${priseEnCharge}`}
        />
      </BentoItem>
    </>
  );
}

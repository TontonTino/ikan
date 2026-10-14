import React from 'react';
import type { DashboardAgence, StatKPI } from '../../types';
import KpiCard, { type KpiCardProps } from '../ui/KpiCard';
import { BentoItem } from '../ui/BentoGrid';
import { AlertTriangleIcon, ClockIcon, MessageSquareIcon, SmileIcon } from '../common/Icons';
import { TEXTE_SANS_DONNEES_AVANT, presenterEvolution } from '../../utils/evolution';

type Props = {
  data: DashboardAgence;
  jours: number;
};

const pluriel = (n: number, mot: string) => `${n} ${mot}${n !== 1 ? 's' : ''}`;
// « avis » est invariable : jamais « aviss ».
const avis = (n: number) => `${n} avis`;

interface Comparaison {
  /** Évolution pour KpiCard (flèche + signe + valeur) ; absente s'il n'y a rien à comparer. */
  trend?: NonNullable<KpiCardProps['trend']>;
  /** « vs N avis sur les 30 jours précédents », ou « Pas de données avant » ; vide si l'API ne fournit pas de comparaison. */
  contexte: string;
}

/** Évolution d'un indicateur par rapport à la période précédente de même durée (voir utils/evolution.ts). */
function comparer(kpi: StatKPI | undefined, data: DashboardAgence, jours: number): Comparaison {
  const comparaison = data.comparaison;
  if (!comparaison || !kpi) return { contexte: '' };
  const evolution = presenterEvolution(kpi, comparaison.nombre_feedbacks_precedent);
  if (evolution.etat === 'sans_donnees_avant') return { contexte: TEXTE_SANS_DONNEES_AVANT };
  if (evolution.etat === 'indisponible') return { contexte: '' };
  return {
    trend: {
      value: evolution.valeur,
      isPositive: evolution.favorable,
      direction: evolution.sens === 'hausse' ? 'up' : evolution.sens === 'baisse' ? 'down' : 'flat',
    },
    contexte: `vs ${avis(comparaison.nombre_feedbacks_precedent)} sur les ${jours} jours précédents`,
  };
}

/**
 * Situation de l'agence : quatre indicateurs, chacun avec sa valeur réelle et sa période. La satisfaction et les avis reçus sont
 * comparés à la période précédente de même durée (même agence) quand l'API la fournit ; sans avis avant : « Pas de données avant ».
 * Rendus comme cases de la grille « bento » (même composition que la vue réseau du CX Manager).
 */
export default function AgencyDecisionKpis({ data, jours }: Props) {
  const sansAvis = data.nombre_feedbacks === 0 || data.taux_satisfaction == null;
  const priseEnCharge = data.taux_prise_en_charge === null ? 'prise en charge : aucune donnée' : `${data.taux_prise_en_charge} % pris en charge`;

  const sat = comparer(data.comparaison?.satisfaction, data, jours);
  const vol = comparer(data.comparaison?.total_feedbacks, data, jours);

  const sousTitreSat = sansAvis ? `aucun avis sur les ${jours} derniers jours` : `sur ${avis(data.nombre_feedbacks)} · ${jours} derniers jours`;
  const sousTitreVol = `${jours} derniers jours · ${pluriel(data.nombre_negatifs, 'négatif')}`;
  // Avec une évolution, KpiCard affiche `period` à la place du sous-titre : on y remet le contexte (période et base de comparaison).
  const avecContexte = (sousTitre: string, contexte: string) => (contexte ? `${sousTitre} · ${contexte}` : sousTitre);

  return (
    <>
      <BentoItem size="kpi" as="div">
        <KpiCard
          icon={<SmileIcon />}
          label="Satisfaction"
          hint="Part des avis notés 4 ou 5 sur 5 sur la période, comparée à la période précédente de même durée (écart en points)."
          value={sansAvis ? 'Aucune donnée' : `${data.taux_satisfaction} %`}
          tone={sansAvis ? 'neutral' : 'positive'}
          highlight={!sansAvis}
          trend={sat.trend && { ...sat.trend, period: avecContexte(sousTitreSat, sat.contexte) }}
          subtitle={avecContexte(sousTitreSat, sansAvis ? '' : sat.contexte)}
        />
      </BentoItem>
      <BentoItem size="kpi" as="div">
        <KpiCard
          icon={<MessageSquareIcon />}
          label="Avis reçus"
          hint="Nombre d’avis reçus par l’agence sur la période, comparé à la période précédente de même durée (variation en %)."
          value={data.nombre_feedbacks.toLocaleString('fr-FR')}
          tone="neutral"
          trend={vol.trend && { ...vol.trend, period: avecContexte(sousTitreVol, vol.contexte) }}
          subtitle={avecContexte(sousTitreVol, vol.contexte)}
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

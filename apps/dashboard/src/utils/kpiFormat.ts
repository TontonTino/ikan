/**
 * Formatage des KPI (KPI Engine, app/services/kpi/) — extrait de PilotagePage.tsx pour
 * être partagé avec KpiCoreGrid (onglet Issues du Pilotage, CX Manager). Fonctions
 * pures, sans JSX : kpiIconComponent renvoie le composant icône lui-même (pas un élément
 * rendu), à instancier par l'appelant.
 *
 * Table complétée pour les 14 KPI actuels (communs prioritaires + communs opérationnels,
 * voir app/services/kpi/packs.py) ; un futur KPI sectoriel sans entrée ici retombe sur
 * l'icône générique ActivityIcon, jamais une erreur.
 */
import type { ComponentType } from 'react';
import type { IconProps } from '../components/common/Icons';
import type { KPIResult } from '../types';
import {
  SmileIcon,
  ThumbsDownIcon,
  MessageSquareIcon,
  TargetIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldCheckIcon,
  ActivityIcon,
  TrendingUpIcon,
  LayoutGridIcon,
  CalendarIcon,
  CheckIcon,
  LightningIcon,
  RefreshCwIcon,
} from '../components/common/Icons';

const ICONE_PAR_CODE: Record<string, ComponentType<IconProps>> = {
  // Communs prioritaires
  CSAT: SmileIcon,
  NPS: TrendingUpIcon,
  NEGATIVE_SENTIMENT_RATE: ThumbsDownIcon,
  ISSUE_VOLUME: TargetIcon,
  CRITICAL_ISSUE_RATE: AlertTriangleIcon,
  ISSUE_RESOLUTION_RATE: CheckCircleIcon,
  MEDIAN_RESOLUTION_TIME: ClockIcon,
  LOOP_CLOSURE_RATE: ShieldCheckIcon,
  // Communs opérationnels
  FEEDBACK_VOLUME: MessageSquareIcon,
  ISSUE_BACKLOG: LayoutGridIcon,
  BACKLOG_AGE: CalendarIcon,
  ACTION_COMPLETION_RATE: CheckIcon,
  SLA_COMPLIANCE_RATE: LightningIcon,
  ISSUE_RECURRENCE_RATE: RefreshCwIcon,
};

export function kpiIconComponent(code: string): ComponentType<IconProps> {
  return ICONE_PAR_CODE[code] ?? ActivityIcon;
}

// Règle stricte du backend (KPI Engine) : status "no_data" signifie qu'aucune donnée
// exploitable n'existe pour la période — jamais un 0%/0 trompeur. Le frontend ne doit
// pas la contredire en affichant un faux zéro.
export function formatKpiValue(k: KPIResult): string {
  if (k.status === 'no_data' || k.value === null) return 'Pas de données';
  if (k.unit === 'percent') return `${k.value}%`;
  if (k.unit === 'hours') return `${k.value} h`;
  return `${Math.round(k.value)}`;
}

// LOOP_CLOSURE_RATE : exigence produit — toujours afficher la base ("X vérifiées sur Y
// nécessitant une action") sous le pourcentage, jamais le pourcentage seul, pour que le
// KPI reste interprétable même quand peu d'Issues sont encore vérifiées.
export function formatKpiSubtitle(k: KPIResult, jours: number): string {
  if (k.code === 'LOOP_CLOSURE_RATE') {
    const verifiees = k.verified_count ?? 0;
    const requises = k.requiring_action_count ?? 0;
    return `${verifiees} vérifiée${verifiees !== 1 ? 's' : ''} sur ${requises} nécessitant une action`;
  }
  if (k.status === 'no_data') return 'sur cette période';
  return `${jours} derniers jours`;
}

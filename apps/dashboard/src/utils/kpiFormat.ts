/**
 * Formatage des 8 KPI P0 (KPI Engine, app/services/kpi/) — extrait de PilotagePage.tsx
 * pour être partagé avec KpiCoreGrid (Pilotage/Issues et Vue d'ensemble Agency Manager).
 * Fonctions pures, sans JSX : kpiIconComponent renvoie le composant icône lui-même (pas
 * un élément rendu), à instancier par l'appelant.
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
} from '../components/common/Icons';

export function kpiIconComponent(code: string): ComponentType<IconProps> {
  switch (code) {
    case 'CSAT':
      return SmileIcon;
    case 'NEGATIVE_SENTIMENT_RATE':
      return ThumbsDownIcon;
    case 'FEEDBACK_VOLUME':
      return MessageSquareIcon;
    case 'ISSUE_VOLUME':
      return TargetIcon;
    case 'CRITICAL_ISSUE_RATE':
      return AlertTriangleIcon;
    case 'ISSUE_RESOLUTION_RATE':
      return CheckCircleIcon;
    case 'MEDIAN_RESOLUTION_TIME':
      return ClockIcon;
    case 'LOOP_CLOSURE_RATE':
      return ShieldCheckIcon;
    default:
      return ActivityIcon;
  }
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

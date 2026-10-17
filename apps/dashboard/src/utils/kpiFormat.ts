/**
 * Formatage des KPI (KPI Engine, app/services/kpi/) — extrait de PilotagePage.tsx pour
 * être partagé avec KpiCoreGrid (onglet Issues du Pilotage, CX Manager). Fonctions
 * pures, sans JSX : kpiIconComponent renvoie le composant icône lui-même (pas un élément
 * rendu), à instancier par l'appelant.
 *
 * Table complétée pour les 15 KPI communs + les 3 KPI du pack telecom (voir
 * app/services/kpi/packs.py et packs_telecom.py) ; un futur KPI sectoriel sans entrée ici
 * retombe sur l'icône générique ActivityIcon, jamais une erreur.
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
  MegaphoneIcon,
  WifiHighIcon,
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
  ESCALATION_RATE: MegaphoneIcon,
  // Pack telecom (famille sectorielle)
  TEL_PART_HORS_PERIMETRE: WifiHighIcon,
  TEL_RECURRENCE_AGENCE: RefreshCwIcon,
  TEL_RECURRENCE_HORS_PERIMETRE: RefreshCwIcon,
};

export function kpiIconComponent(code: string): ComponentType<IconProps> {
  return ICONE_PAR_CODE[code] ?? ActivityIcon;
}

const LIBELLE_KPI: Record<string, string> = {
  CSAT: 'Satisfaction client',
  NPS: 'Recommandation client',
  NEGATIVE_SENTIMENT_RATE: 'Part des avis au ton négatif',
  ISSUE_VOLUME: 'Problèmes signalés',
  CRITICAL_ISSUE_RATE: 'Part des problèmes critiques',
  ISSUE_RESOLUTION_RATE: 'Taux de résolution',
  MEDIAN_RESOLUTION_TIME: 'Délai médian de résolution',
  LOOP_CLOSURE_RATE: 'Part des problèmes vérifiés',
  FEEDBACK_VOLUME: 'Avis clients reçus',
  ISSUE_BACKLOG: 'Problèmes ouverts',
  BACKLOG_AGE: 'Ancienneté des problèmes ouverts',
  ACTION_COMPLETION_RATE: 'Actions menées à terme',
  SLA_COMPLIANCE_RATE: 'Respect des délais de traitement',
  ISSUE_RECURRENCE_RATE: 'Récurrence des problèmes',
  ESCALATION_RATE: 'Part des problèmes escaladés',
  TEL_PART_HORS_PERIMETRE: 'Problèmes hors périmètre',
  TEL_RECURRENCE_AGENCE: 'Récurrence dans l’agence',
  TEL_RECURRENCE_HORS_PERIMETRE: 'Récurrence hors périmètre',
};

export function formatKpiLabel(k: KPIResult): string {
  if (LIBELLE_KPI[k.code]) return LIBELLE_KPI[k.code];
  const label = k.label?.trim();
  // Préserve les libellés personnalisés, sans exposer un code technique reçu en guise de label.
  return label && !/^[A-Z][A-Z0-9_]*$/.test(label) ? label : 'Indicateur complémentaire';
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
  // TEL_PART_HORS_PERIMETRE : le nombre d'Issues non classées doit rester visible même en
  // no_data (denominateur < 5), car "pas assez d'Issues classées" n'est pas la même
  // information que "aucune Issue non classée" — voir app/services/kpi/engine.py.
  if (k.code === 'TEL_PART_HORS_PERIMETRE' && k.non_classees_count != null) {
    const n = k.non_classees_count;
    const base = `${n} problème${n !== 1 ? 's' : ''} non classé${n !== 1 ? 's' : ''}`;
    return k.status === 'no_data' ? base : `${base} · ${jours} derniers jours`;
  }
  // NPS : le dénominateur EST le nombre de réponses (voir calculer_nps,
  // app/services/kpi/engine.py) — sous 5, le score est statistiquement peu fiable, on le
  // dit plutôt que de laisser croire à un NPS aussi solide qu'avec un grand échantillon.
  if (k.code === 'NPS' && k.status === 'ok' && k.denominator != null && k.denominator < 5) {
    const n = k.denominator;
    return `Échantillon faible (${n} réponse${n !== 1 ? 's' : ''})`;
  }
  if (k.status === 'no_data') return 'sur cette période';
  return `${jours} derniers jours`;
}

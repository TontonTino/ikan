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
import { INDICATEUR_AIDE, LIBELLES } from './vocabulaire';
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
import { formaterPourcentage } from './formatNombre';

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

// Libellés de repli, alignés sur app/services/kpi/definitions.py. Le libellé envoyé par l'API
// reste prioritaire ; ce dictionnaire ne sert que s'il est absent ou s'il ressemble à un code.
const LIBELLE_PAR_CODE: Record<string, string> = {
  CSAT: 'Satisfaction client (CSAT)',
  NPS: 'Recommandation (NPS)',
  NEGATIVE_SENTIMENT_RATE: 'Part d’avis négatifs',
  FEEDBACK_VOLUME: 'Avis reçus',
  ISSUE_VOLUME: 'Problèmes enregistrés',
  CRITICAL_ISSUE_RATE: 'Part de problèmes critiques',
  ISSUE_RESOLUTION_RATE: 'Taux de résolution des problèmes',
  MEDIAN_RESOLUTION_TIME: 'Temps médian de résolution',
  LOOP_CLOSURE_RATE: 'Résolutions vérifiées',
  ISSUE_BACKLOG: 'Problèmes en attente',
  BACKLOG_AGE: 'Ancienneté des problèmes en attente',
  ACTION_COMPLETION_RATE: 'Taux d’actions terminées',
  SLA_COMPLIANCE_RATE: 'Respect des délais de traitement',
  ISSUE_RECURRENCE_RATE: 'Part de problèmes récurrents',
  ESCALATION_RATE: 'Part de problèmes remontés',
  TEL_PART_HORS_PERIMETRE: 'Part hors périmètre agence',
  TEL_RECURRENCE_AGENCE: 'Récurrence (périmètre agence)',
  TEL_RECURRENCE_HORS_PERIMETRE: 'Récurrence (hors périmètre agence)',
  TEL_RECLAMATIONS_RESEAU: 'Réclamations réseau (d’après les avis)',
  TEL_RECLAMATIONS_RECHARGE_FORFAIT: 'Réclamations recharge & forfaits (d’après les avis)',
  TEL_RECLAMATIONS_FACTURATION: 'Réclamations facturation (d’après les avis)',
  RESTO_TAUX_TRAITEMENT_RECONTACTS: 'Taux de clients recontactés',
  RESTO_RISQUE_SILENCIEUX: 'Risque silencieux',
  RESTO_RECIDIVE_CATEGORIE: 'Récidive par catégorie',
};

/** Libellé affiché d'un indicateur : celui de l'API s'il est lisible, sinon le dictionnaire,
    sinon un libellé générique (jamais le code technique). */
export function kpiLibelle(k: Pick<KPIResult, 'code' | 'label'>): string {
  const label = k.label?.trim();
  if (label && !/^[A-Z0-9_]+$/.test(label)) return label;
  return LIBELLE_PAR_CODE[k.code] ?? 'Indicateur';
}

export function kpiIconComponent(code: string): ComponentType<IconProps> {
  return ICONE_PAR_CODE[code] ?? ActivityIcon;
}

// Règle stricte du backend (KPI Engine) : status "no_data" signifie qu'aucune donnée
// exploitable n'existe pour la période — jamais un 0%/0 trompeur. Le frontend ne doit
// pas la contredire en affichant un faux zéro.
export function formatKpiValue(k: KPIResult): string {
  if (k.status === 'no_data' || k.value === null) return LIBELLES.aucuneDonneeCourt;
  if (k.unit === 'percent') return formaterPourcentage(k.value);
  // NPS : score en points (−100 à +100), jamais un pourcentage.
  if (k.unit === 'points') return `${k.value > 0 ? '+' : ''}${Math.round(k.value)} pts`;
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
  if (k.status === 'no_data') return `Pas assez de données sur ${jours} jours`;
  return `${jours} derniers jours`;
}

/**
 * Indicateurs qui reposent sur des données que l'interface ne permet pas (encore) de produire : durée de résolution, boucle fermée, résolution,
 * délai de traitement (SLA), récurrence. Tant que ces données manquent, afficher « 0 % » ou « Aucune donnée / pas assez de données sur 30 jours »
 * serait trompeur (le manque ne vient ni de la période ni d'une réalité mesurée) : on dit « Non renseigné » et pourquoi.
 * Aucun chiffre n'est inventé : un indicateur réellement calculé (par exemple depuis l'API) garde sa valeur.
 */
const CODES_RECURRENCE = ['ISSUE_RECURRENCE_RATE', 'RESTO_RECIDIVE_CATEGORIE', 'TEL_RECURRENCE_AGENCE', 'TEL_RECURRENCE_HORS_PERIMETRE'];

export interface EtatNonRenseigne {
  valeur: string;
  sousTitre: string;
}

const sansValeur = (k: KPIResult) => k.status === 'no_data' || k.value === null;

/**
 * « Non renseigné » + une phrase exacte, ou null (l'indicateur s'affiche normalement). Chaque phrase est vraie PAR DÉFINITION de l'indicateur :
 *  - durée de résolution : aucun problème résolu parmi ceux de la période ;
 *  - boucle fermée : aucun problème de la période n'a d'action décidée ;
 *  - délai (SLA) : aucun problème résolu de la période n'avait de délai renseigné ;
 *  - taux de résolution à 0 : aucun problème résolu, sur N enregistrés ;
 *  - récurrence à 0 (numérateur nul) : aucun problème n'est relié à un problème antérieur. Sans valeur (moins de 5 problèmes résolus…), le message
 *    habituel reste : la cause n'est alors pas l'absence de lien.
 */
export function etatNonRenseigne(k: KPIResult): EtatNonRenseigne | null {
  const valeur = LIBELLES.nonRenseigne;
  switch (k.code) {
    case 'MEDIAN_RESOLUTION_TIME':
      return sansValeur(k) ? { valeur, sousTitre: 'Aucun problème résolu parmi ceux de la période : la durée se calcule dès qu’un problème est résolu.' } : null;
    case 'LOOP_CLOSURE_RATE':
      return sansValeur(k) ? { valeur, sousTitre: 'Aucun problème de la période n’a d’action décidée : le taux se calcule dès qu’une action existe sur un problème.' } : null;
    case 'SLA_COMPLIANCE_RATE':
      return sansValeur(k) ? { valeur, sousTitre: 'Aucun problème résolu de la période n’avait de délai de traitement renseigné.' } : null;
    case 'ISSUE_RESOLUTION_RATE': {
      if (sansValeur(k) || (k.numerator ?? 0) !== 0) return null;
      const n = k.denominator ?? 0;
      return { valeur, sousTitre: `Aucun problème résolu pour l’instant, sur ${n} enregistré${n > 1 ? 's' : ''}.` };
    }
    default:
      if (CODES_RECURRENCE.includes(k.code) && !sansValeur(k) && (k.numerator ?? 0) === 0) {
        return { valeur, sousTitre: 'Aucun problème n’est relié à un problème antérieur : la récurrence se calcule dès qu’un lien est renseigné.' };
      }
      return null;
  }
}

/** Explication courte d'un indicateur (infobulle « ? »), absente si le code est inconnu. */
export function kpiAide(code: string): string | undefined {
  return INDICATEUR_AIDE[code];
}

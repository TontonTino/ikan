/**
 * Lecture du suivi d'un problème à traiter (Issue) à partir des seuls champs renvoyés par
 * l'API : ancienneté, délai de traitement, urgence et prochain geste. Fonctions pures.
 * Rien n'est déduit des actions : la liste des problèmes ne les contient pas.
 */
import type { CriticiteType, Issue, IssueStatut } from '../types';

const JOUR_MS = 86_400_000;

export type SuiviIssue = Pick<Issue, 'statut' | 'severite' | 'premiere_detection' | 'date_limite_sla'>;

/** Problème encore à traiter : ni résolu, ni vérifié. */
export const estEnAttente = (statut: IssueStatut) => statut !== 'resolue' && statut !== 'verifiee';

export function joursDepuis(iso: string, maintenant: number): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((maintenant - t) / JOUR_MS));
}

export function libelleJours(jours: number): string {
  if (jours <= 0) return 'aujourd’hui';
  return `${jours} jour${jours > 1 ? 's' : ''}`;
}

export type EtatDelai = { etat: 'depasse' | 'a_venir'; jours: number; date: string };

/** Délai de traitement : seulement si l'API en fournit un et que le problème reste à traiter. */
export function etatDelai(issue: SuiviIssue, maintenant: number): EtatDelai | null {
  if (!issue.date_limite_sla || !estEnAttente(issue.statut)) return null;
  const limite = new Date(issue.date_limite_sla).getTime();
  if (Number.isNaN(limite)) return null;
  if (maintenant > limite) return { etat: 'depasse', jours: Math.floor((maintenant - limite) / JOUR_MS), date: issue.date_limite_sla };
  return { etat: 'a_venir', jours: Math.ceil((limite - maintenant) / JOUR_MS), date: issue.date_limite_sla };
}

/** Prochain geste à effectuer, d'après le seul statut (aucune étape n'est automatisée). */
export function prochainGeste(statut: IssueStatut): string {
  switch (statut) {
    case 'ouverte':
      return 'À examiner et à prendre en charge';
    case 'action_en_cours':
      return 'Suivre l’avancement des actions';
    case 'reouverte':
      return 'Rouvert : à réexaminer';
    case 'resolue':
      return 'À vérifier : la résolution est-elle confirmée ?';
    case 'verifiee':
      return 'Résolution vérifiée — rien à faire';
    default:
      return 'Statut non précisé';
  }
}

const POIDS_GRAVITE: Record<CriticiteType, number> = { critique: 60, elevee: 40, moyenne: 20, faible: 0 };

/** Un problème mérite d'être mis en évidence : délai dépassé, ou gravité critique encore à traiter. */
export function estUrgent(issue: SuiviIssue, maintenant: number): boolean {
  if (!estEnAttente(issue.statut)) return false;
  return etatDelai(issue, maintenant)?.etat === 'depasse' || issue.severite === 'critique';
}

/** Score de tri « plus urgents d'abord » : délai dépassé, puis gravité, puis problème rouvert. */
export function scoreUrgence(issue: SuiviIssue, maintenant: number): number {
  if (issue.statut === 'verifiee') return 0;
  if (issue.statut === 'resolue') return 10;
  let score = POIDS_GRAVITE[issue.severite] ?? 0;
  if (etatDelai(issue, maintenant)?.etat === 'depasse') score += 100;
  if (issue.statut === 'reouverte') score += 15;
  return score + 20;
}

export function trierParUrgence<T extends SuiviIssue>(issues: T[], maintenant: number): T[] {
  return [...issues].sort(
    (a, b) =>
      scoreUrgence(b, maintenant) - scoreUrgence(a, maintenant) ||
      new Date(a.premiere_detection).getTime() - new Date(b.premiere_detection).getTime(),
  );
}

export type GroupeStatut = 'tous' | 'en_attente' | 'a_verifier' | 'verifies';

export const GROUPES_STATUT: { id: GroupeStatut; label: string }[] = [
  { id: 'tous', label: 'Tous' },
  { id: 'en_attente', label: 'À traiter' },
  { id: 'a_verifier', label: 'À vérifier' },
  { id: 'verifies', label: 'Vérifiés' },
];

export function correspondAuGroupe(statut: IssueStatut, groupe: GroupeStatut): boolean {
  switch (groupe) {
    case 'en_attente':
      return estEnAttente(statut);
    case 'a_verifier':
      return statut === 'resolue';
    case 'verifies':
      return statut === 'verifiee';
    default:
      return true;
  }
}

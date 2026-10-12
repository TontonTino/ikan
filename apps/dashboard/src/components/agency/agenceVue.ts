import type { Alerte, AlerteFeedback, Issue, IssueStatut, PriorityLevel, Recommandation, TendanceSatisfaction } from '../../types';
import { GRAVITE_LABELS, PROBLEME_STATUT_LABELS, libelleRaisonAlerte } from '../../utils/vocabulaire';

/**
 * Règles de lecture de la vue d'ensemble du Responsable d'agence (/agence).
 * Tout provient de données réelles déjà chargées : aucun score, aucun seuil et aucune comparaison inventés.
 */

// ── Priorités : alertes de seuil, problèmes à traiter, avis à examiner ─────────────────────────────

/** Trois notions distinctes, jamais mélangées : une alerte signale, un problème est suivi, un avis est un retour client. */
export type PrioriteKind = 'seuil' | 'probleme' | 'avis';
export type PrioriteTon = 'critical' | 'warning';

export interface Priorite {
  id: string;
  kind: PrioriteKind;
  ton: PrioriteTon;
  /** Libellé du type, affiché en badge (le type ne dépend jamais de la couleur seule). */
  type: string;
  titre: string;
  detail: string;
  lien: { to: string; label: string };
}

export const PROBLEMES_OUVERTS: IssueStatut[] = ['ouverte', 'action_en_cours', 'reouverte'];

const ORDRE_KIND: Record<PrioriteKind, number> = { seuil: 0, probleme: 1, avis: 2 };
const ORDRE_GRAVITE: Record<string, number> = { critique: 0, elevee: 1 };

const extrait = (texte: string, max = 110) => (texte.length > max ? `${texte.slice(0, max).trimEnd()}…` : texte);

/** Un problème est prioritaire s'il est ouvert ET (grave OU marqué « nécessite une action »). Règle déjà en place sur la page. */
export const estProblemePrioritaire = (issue: Issue) =>
  PROBLEMES_OUVERTS.includes(issue.statut) && (issue.severite === 'critique' || issue.severite === 'elevee' || issue.necessite_action);

export function construirePriorites(entrees: { alertes: Alerte[]; avis: AlerteFeedback[]; problemes: Issue[] }): Priorite[] {
  const seuils: Priorite[] = entrees.alertes.map((a) => ({
    id: `seuil-${a.agence_id}`,
    kind: 'seuil',
    ton: 'critical',
    type: 'Alerte de seuil',
    titre: 'Satisfaction sous le seuil de l’agence',
    detail: `Taux actuel ${a.taux_actuel} % pour un seuil de ${a.seuil} %.`,
    lien: { to: '/statistiques', label: 'Analyser la tendance' },
  }));

  const problemes: Priorite[] = entrees.problemes.filter(estProblemePrioritaire).map((p) => ({
    id: `probleme-${p.id}`,
    kind: 'probleme',
    ton: p.severite === 'critique' ? 'critical' : 'warning',
    type: 'Problème à traiter',
    titre: p.titre,
    detail: `Gravité ${(GRAVITE_LABELS[p.severite] ?? 'non précisée').toLowerCase()} · ${PROBLEME_STATUT_LABELS[p.statut] ?? 'statut inconnu'}`,
    lien: { to: '/issues', label: 'Voir les problèmes' },
  }));

  const avis: Priorite[] = entrees.avis.map((a) => ({
    id: `avis-${a.feedback_id}`,
    kind: 'avis',
    ton: a.note <= 2 ? 'critical' : 'warning',
    type: 'Avis à examiner',
    titre: `Note ${a.note}/5${a.categorie_nom ? ` · ${a.categorie_nom}` : ''}`,
    detail: `${libelleRaisonAlerte(a.raison)}${a.commentaire ? ` · « ${extrait(a.commentaire)} »` : ''}`,
    lien: { to: '/feedbacks?tab=critiques', label: 'Examiner les avis' },
  }));

  const gravite = (p: Priorite, source: Issue[]) =>
    ORDRE_GRAVITE[source.find((i) => `probleme-${i.id}` === p.id)?.severite ?? ''] ?? 2;
  const noteDe = (p: Priorite) => entrees.avis.find((a) => `avis-${a.feedback_id}` === p.id)?.note ?? 5;

  return [...seuils, ...problemes, ...avis].sort((a, b) => {
    if (a.ton !== b.ton) return a.ton === 'critical' ? -1 : 1;
    if (a.kind !== b.kind) return ORDRE_KIND[a.kind] - ORDRE_KIND[b.kind];
    if (a.kind === 'probleme') return gravite(a, entrees.problemes) - gravite(b, entrees.problemes);
    if (a.kind === 'avis') return noteDe(a) - noteDe(b);
    return 0;
  });
}

// ── Recommandations : tri et regroupement par priorité (champ existant `priorite`) ──────────────────

const RANG_PRIORITE: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const PRIORITE_RECO_LABEL: Record<PriorityLevel, string> = { critical: 'Critique', high: 'Élevée', medium: 'Moyenne', low: 'Faible' };
export const PRIORITE_RECO_TON: Record<PriorityLevel, 'critical' | 'warning' | 'info' | 'success'> = {
  critical: 'critical',
  high: 'warning',
  medium: 'info',
  low: 'success',
};

export function trierRecommandations<T extends Recommandation>(recos: T[]): T[] {
  return [...recos].sort(
    (a, b) =>
      (RANG_PRIORITE[a.priorite] ?? 9) - (RANG_PRIORITE[b.priorite] ?? 9) ||
      new Date(b.date_generation).getTime() - new Date(a.date_generation).getTime(),
  );
}

export interface GroupeRecommandations<T extends Recommandation = Recommandation> {
  priorite: PriorityLevel;
  label: string;
  items: T[];
}

export function grouperRecommandations<T extends Recommandation>(recos: T[]): GroupeRecommandations<T>[] {
  const groupes = new Map<PriorityLevel, T[]>();
  for (const reco of trierRecommandations(recos)) groupes.set(reco.priorite, [...(groupes.get(reco.priorite) ?? []), reco]);
  return [...groupes.entries()].map(([priorite, items]) => ({ priorite, label: PRIORITE_RECO_LABEL[priorite] ?? String(priorite), items }));
}

// ── Évolution de la satisfaction ───────────────────────────────────────────────────────────────────

export function variationPeriode(points: TendanceSatisfaction[]): number | null {
  const valides = points.filter((p) => Number.isFinite(p.taux));
  if (valides.length < 2) return null;
  return Math.round((valides[valides.length - 1].taux - valides[0].taux) * 10) / 10;
}

/** Phrase d'interprétation : uniquement ce que les relevés permettent d'affirmer. */
export function interpretationEvolution(points: TendanceSatisfaction[]): string {
  const variation = variationPeriode(points);
  if (variation === null) return 'Variation indisponible : au moins deux relevés sont nécessaires.';
  if (variation === 0) return 'La satisfaction est stable entre le premier et le dernier relevé de la période.';
  return `La satisfaction ${variation > 0 ? 'progresse' : 'recule'} de ${Math.abs(variation).toLocaleString('fr-FR')} point${Math.abs(variation) > 1 ? 's' : ''} entre le premier et le dernier relevé de la période.`;
}

/** Alternative textuelle du graphique : l'essentiel sans avoir à lire la courbe. */
export function resumeAccessibleEvolution(points: TendanceSatisfaction[]): string {
  if (points.length === 0) return 'Aucun relevé de satisfaction sur la période.';
  const taux = points.map((p) => p.taux);
  const min = points.reduce((a, b) => (b.taux < a.taux ? b : a));
  const max = points.reduce((a, b) => (b.taux > a.taux ? b : a));
  return (
    `${points.length} relevé${points.length > 1 ? 's' : ''}, du ${points[0].date} au ${points[points.length - 1].date}. ` +
    `Premier relevé : ${taux[0]} %, dernier : ${taux[taux.length - 1]} %. ` +
    `Plus bas : ${min.taux} % (${min.date}), plus haut : ${max.taux} % (${max.date}). ` +
    `${interpretationEvolution(points)}`
  );
}

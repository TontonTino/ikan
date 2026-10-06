/**
 * Transformations de données du Dashboard CX (Decision Workspace).
 * Fonctions pures, sans JSX : testables isolément.
 *
 * Règles « data-first » appliquées ici :
 *  - aucune valeur n'est inventée : une donnée absente est renvoyée `null` et
 *    l'interface affiche son absence ;
 *  - 0 avis ≠ 0 % : une agence ou une période sans avis est « Pas d'avis »,
 *    jamais une mauvaise performance ;
 *  - aucun delta n'est affiché si la période précédente n'a aucun avis
 *    (l'API renvoie alors une évolution null et un taux null / status "no_data").
 */
import type { AgenceRankDetail, Alerte, EvolutionPoint, Issue, StatKPI } from '../../../types';

// ════════════════════════════════════════════════════════════════════
// PARAMÈTRES PROVISOIRES — « À surveiller »
// Validés comme provisoires (étape 4), PAS comme règles métier définitives.
// Modifier ici uniquement : toute la logique et les libellés en dérivent.
// ════════════════════════════════════════════════════════════════════
export const SURVEILLANCE = {
  /** Baisse de satisfaction (en points vs période précédente) à partir de laquelle une agence est signalée. */
  BAISSE_MIN_PTS: 10,
  /**
   * Nombre minimal d'avis sur la PÉRIODE COURANTE pour signaler une baisse.
   * Limite API : le volume de la période précédente par agence n'est pas exposé
   * par /statistics/cx, il ne peut donc pas être vérifié ici.
   */
  BAISSE_MIN_AVIS: 10,
  /** Nombre maximal de lignes affichées dans « À surveiller ». */
  MAX_LIGNES: 5,
} as const;

/**
 * PROVISOIRE — Nombre minimal d'avis pour comparer une satisfaction à un seuil
 * (répartition Réseau, carte) et pour entrer dans le classement Wilson.
 * Aligné sur la règle de l'API pour les alertes de seuil (≥ 3 avis).
 */
export const MIN_AVIS_SEUIL = 3;

/** PROVISOIRE — En dessous de ce nombre d'avis, un point de la courbe est signalé « faible volume ». */
export const FAIBLE_VOLUME_POINT = 5;

/**
 * Lisibilité (pas un seuil métier) : au-delà de ce nombre de points journaliers,
 * une sparkline est regroupée par semaine (regroupement exact, voir aggregateWeekly).
 */
export const SPARKLINE_MAX_POINTS_JOUR = 14;

/**
 * Rang de priorité « À surveiller » jusqu'auquel une agence est traitée comme critique
 * (rouge) : 1 = sous son seuil, 2 = feedbacks critiques. Au-delà : attention (orange).
 */
export const RANG_CRITIQUE_MAX = 2;

/**
 * MIROIR DE L'API (non modifiable ici) — règle de calcul des alertes de seuil
 * côté backend (alertes.py, CX Manager). Sert uniquement à l'EXPLIQUER dans l'interface.
 */
export const REGLE_ALERTE_SEUIL_API = {
  fenetreJours: 7,
  minAvis: MIN_AVIS_SEUIL,
  persistanceHeures: 48,
} as const;

/** Explication unique de la règle d'alerte, réutilisée par tous les composants. */
export const regleAlerteSeuilTexte = () =>
  `Satisfaction sur ${REGLE_ALERTE_SEUIL_API.fenetreJours} jours glissants (au moins ${REGLE_ALERTE_SEUIL_API.minAvis} avis), ` +
  `restée sous le seuil configuré de l'agence depuis plus de ${REGLE_ALERTE_SEUIL_API.persistanceHeures} h.`;

/** Statuts d'Issue considérés comme ouverts (IssueStatut). */
export const ISSUE_STATUTS_OUVERTS = ['ouverte', 'action_en_cours', 'reouverte'] as const;

// ────────────────────────────────────────────────────────────────────
// Deltas des KPI (calculés ici, pas repris des chaînes de l'API)
// ────────────────────────────────────────────────────────────────────

export interface KpiDelta {
  /** Texte affiché, ex. « +3,2 pts », « −12 % », « +4 ». */
  text: string;
  direction: 'up' | 'down' | 'flat';
  /** Valence : l'évolution est-elle favorable ? */
  isPositive: boolean;
}

const fmt = (n: number, digits = 1) =>
  n.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const signed = (n: number, suffix: string, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), digits)}${suffix}`;

/**
 * Variation de satisfaction en POINTS. Null si l'une des deux périodes n'a aucun avis.
 * `volume` = KPI total_feedbacks (sa valeur_precedente donne le volume de la période précédente).
 */
export function satisfactionDelta(satisfaction: StatKPI | undefined, volume: StatKPI | undefined): KpiDelta | null {
  if (!satisfaction || !volume) return null;
  const volCur = volume.valeur_num;
  const volPrev = volume.valeur_precedente ?? 0;
  if (!volCur || !volPrev || satisfaction.valeur_num == null || satisfaction.valeur_precedente == null) return null;
  const diff = Math.round((satisfaction.valeur_num - satisfaction.valeur_precedente) * 10) / 10;
  return {
    text: signed(diff, ' pts'),
    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    isPositive: diff >= 0,
  };
}

/** Variation relative d'un volume (en %). Null si la période précédente n'a aucun avis. */
export function volumeDelta(volume: StatKPI | undefined): KpiDelta | null {
  if (!volume) return null;
  const prev = volume.valeur_precedente ?? 0;
  if (!prev || volume.valeur_num == null) return null;
  const pct = Math.round(((volume.valeur_num - prev) / prev) * 1000) / 10;
  return {
    text: signed(pct, ' %'),
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    // Plus de feedbacks = plus de voix clients : neutre-favorable, jamais rouge.
    isPositive: true,
  };
}

/**
 * Variation ABSOLUE d'un compte où « plus » est défavorable (feedbacks critiques).
 * Null si la période précédente n'a aucun avis du tout (`volumePrev` = 0).
 */
export function compteDefavorableDelta(kpi: StatKPI | undefined, volumePrev: number | null | undefined): KpiDelta | null {
  if (!kpi || !volumePrev || kpi.valeur_num == null || kpi.valeur_precedente == null) return null;
  const diff = kpi.valeur_num - kpi.valeur_precedente;
  return {
    text: signed(diff, '', 0),
    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    isPositive: diff <= 0,
  };
}

// ────────────────────────────────────────────────────────────────────
// Évolution : tri et granularité
// ────────────────────────────────────────────────────────────────────

/**
 * Tri chronologique des points d'évolution. Les clés de l'API sont triables
 * lexicalement : jour « 2026-10-04 », semaine ISO « 2026-W09 » (année ISO, donc
 * la semaine 52 de 2025 précède la semaine 1 de 2026).
 */
export function sortEvolution(points: EvolutionPoint[]): EvolutionPoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

export const isDailyPoint = (p: EvolutionPoint) => /^\d{4}-\d{2}-\d{2}$/.test(p.date);

/** Lundi de la semaine ISO d'une date « AAAA-MM-JJ » (calcul en UTC, sans dérive de fuseau). */
function isoWeekStart(day: string): { key: string; label: string } {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // 0 = lundi
  date.setUTCDate(date.getUTCDate() - dow);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return { key: date.toISOString().slice(0, 10), label: `Sem. du ${dd}/${mm}` };
}

/**
 * Regroupe des points JOURNALIERS par semaine ISO, de façon exacte :
 * satisfaction = Σ positifs / Σ feedbacks (pondérée par le volume, pas une moyenne de moyennes).
 * Les points non journaliers sont renvoyés tels quels.
 */
export function aggregateWeekly(points: EvolutionPoint[]): EvolutionPoint[] {
  if (!points.every(isDailyPoint)) return sortEvolution(points);
  const buckets = new Map<string, EvolutionPoint>();
  for (const p of sortEvolution(points)) {
    const { key, label } = isoWeekStart(p.date);
    const b = buckets.get(key) ?? { date: key, label, feedbacks: 0, traites: 0, satisfaction: 0, positifs: 0, neutres: 0, negatifs: 0 };
    b.feedbacks += p.feedbacks;
    b.traites += p.traites;
    b.positifs += p.positifs;
    b.neutres += p.neutres;
    b.negatifs += p.negatifs;
    buckets.set(key, b);
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    satisfaction: b.feedbacks ? Math.round((b.positifs / b.feedbacks) * 1000) / 10 : 0,
  }));
}

/** Série de la sparkline (points avec avis, regroupés par semaine si trop nombreux). Undefined si < 2 points. */
export function serieSparkline(points: EvolutionPoint[]): number[] | undefined {
  const base = sortEvolution(points).filter((p) => p.feedbacks > 0);
  const pts = base.length > SPARKLINE_MAX_POINTS_JOUR && base.every(isDailyPoint) ? aggregateWeekly(base) : base;
  return pts.length >= 2 ? pts.map((p) => p.satisfaction) : undefined;
}

export type Granularite = 'day' | 'week';

/**
 * Granularités EXACTES disponibles selon la période (l'API fournit des points
 * journaliers jusqu'à 60 jours, hebdomadaires au-delà). Pas de « mois » :
 * des semaines à cheval sur deux mois ne permettent pas un regroupement exact.
 */
export function granularitesDisponibles(jours: number): Granularite[] {
  if (jours <= 7) return ['day'];
  if (jours <= 60) return ['day', 'week'];
  return ['week'];
}

// ────────────────────────────────────────────────────────────────────
// Agences : statut vis-à-vis du seuil configuré
// ────────────────────────────────────────────────────────────────────

export type StatutSeuil = 'au_dessus' | 'sous' | 'pas_assez_avis' | 'sans_avis';

export const STATUT_SEUIL_LABEL: Record<StatutSeuil, string> = {
  au_dessus: 'Au-dessus du seuil',
  sous: 'Sous le seuil',
  pas_assez_avis: `Moins de ${MIN_AVIS_SEUIL} avis`,
  sans_avis: "Pas d'avis",
};

/**
 * Statut d'une agence sur la période, comparé à SON seuil configuré (Agence.seuil_alerte).
 * Moins de MIN_AVIS_SEUIL avis : pas de comparaison (même règle que les alertes de l'API).
 */
export function statutSeuil(satisfaction: number | null, avis: number, seuil: number | null | undefined): StatutSeuil {
  if (avis === 0 || satisfaction == null) return 'sans_avis';
  if (avis < MIN_AVIS_SEUIL || seuil == null) return 'pas_assez_avis';
  return satisfaction < seuil ? 'sous' : 'au_dessus';
}

/** Satisfaction affichable : « Pas d'avis » plutôt que « 0 % ». */
export const satisfactionTexte = (satisfaction: number | null, avis: number) =>
  avis === 0 || satisfaction == null ? "Pas d'avis" : `${fmt(satisfaction)} %`;

/**
 * Tendance d'une agence en points, depuis AgenceRankDetail.tendance_val (« -12.3 pts »).
 * L'API renvoie null quand l'une des deux périodes n'a pas d'avis (pas de comparaison).
 */
export function tendancePts(tendance: string | null | undefined): number | null {
  if (!tendance) return null;
  const n = Number.parseFloat(tendance.replace('pts', '').replace(',', '.').replace('−', '-'));
  return Number.isFinite(n) ? n : null;
}

export interface RepartitionReseau {
  au_dessus: number;
  sous: number;
  pas_assez_avis: number;
  sans_avis: number;
  total: number;
}

export function repartitionReseau(ranking: AgenceRankDetail[], seuils: Map<string, number>): RepartitionReseau {
  const r: RepartitionReseau = { au_dessus: 0, sous: 0, pas_assez_avis: 0, sans_avis: 0, total: ranking.length };
  for (const a of ranking) r[statutSeuil(a.satisfaction_rate, a.total_feedbacks, seuils.get(a.agence_id))] += 1;
  return r;
}

/**
 * Meilleures / moins bonnes agences selon le score de Wilson, parmi celles qui ont
 * assez d'avis pour être comparées (une agence sans avis n'est pas « la moins bonne »).
 */
export function extremesWilson(ranking: AgenceRankDetail[], n = 3) {
  const comparables = ranking
    .filter((a) => a.total_feedbacks >= MIN_AVIS_SEUIL)
    .sort((a, b) => b.wilson_score - a.wilson_score || (b.satisfaction_rate ?? -1) - (a.satisfaction_rate ?? -1));
  const meilleures = comparables.slice(0, n);
  const moinsBonnes = comparables.slice(Math.max(n, comparables.length - n)).reverse();
  return { meilleures, moinsBonnes, comparables: comparables.length };
}

// ────────────────────────────────────────────────────────────────────
// « À surveiller » : une ligne par agence, raisons explicites
// ────────────────────────────────────────────────────────────────────

/** Ordre de priorité validé (étape 4). Pas de score composite : le rang de la raison la plus haute. */
export type SignalType = 'sous_seuil' | 'critiques' | 'baisse' | 'issues';
const RANG: Record<SignalType, number> = { sous_seuil: 1, critiques: 2, baisse: 3, issues: 4 };

export interface Signal {
  type: SignalType;
  /** Raison lisible, chiffrée, sans interprétation (« 62 % pour un seuil de 70 % »). */
  texte: string;
  /** Portée temporelle du signal (les sources n'ont pas toutes la même période). */
  portee: string;
}

export interface AgenceASurveiller {
  agence_id: string;
  agence_nom: string;
  ville?: string | null;
  signaux: Signal[];
  /** Rang de la raison la plus prioritaire (1 = sous le seuil). */
  rang: number;
}

export interface SurveillanceInput {
  ranking: AgenceRankDetail[];
  alertesSeuil: Alerte[];
  /** Issues ouvertes (tous statuts ouverts confondus). */
  issuesOuvertes: Issue[];
  jours: number;
}

export function buildSurveillance({ ranking, alertesSeuil, issuesOuvertes, jours }: SurveillanceInput) {
  const parAgence = new Map<string, AgenceASurveiller>();
  const meta = new Map(ranking.map((a) => [a.agence_id, a]));
  const periode = `${jours} derniers jours`;

  const ajouter = (agenceId: string, nom: string, signal: Signal) => {
    const row = parAgence.get(agenceId) ?? {
      agence_id: agenceId,
      agence_nom: nom,
      ville: meta.get(agenceId)?.ville,
      signaux: [],
      rang: 99,
    };
    row.signaux.push(signal);
    row.rang = Math.min(row.rang, RANG[signal.type]);
    parAgence.set(agenceId, row);
  };

  // 1. Sous son seuil configuré — alerte active de l'API (7 jours glissants, ≥ 3 avis, en continu depuis 48 h).
  for (const a of alertesSeuil) {
    ajouter(a.agence_id, a.agence_nom, {
      type: 'sous_seuil',
      texte: `${fmt(a.taux_actuel)} % pour un seuil de ${fmt(a.seuil)} %`,
      portee: `${REGLE_ALERTE_SEUIL_API.fenetreJours} derniers jours`,
    });
  }

  // 2. Feedbacks critiques (criticité IA « critique ») sur la période.
  for (const a of ranking) {
    if (a.alertes_critiques > 0) {
      ajouter(a.agence_id, a.agence_nom, {
        type: 'critiques',
        texte: `${a.alertes_critiques} feedback${a.alertes_critiques > 1 ? 's' : ''} critique${a.alertes_critiques > 1 ? 's' : ''}`,
        portee: periode,
      });
    }
  }

  // 3. Baisse importante vs période précédente (paramètres provisoires SURVEILLANCE).
  for (const a of ranking) {
    const pts = tendancePts(a.tendance_val);
    if (pts != null && pts <= -SURVEILLANCE.BAISSE_MIN_PTS && a.total_feedbacks >= SURVEILLANCE.BAISSE_MIN_AVIS) {
      ajouter(a.agence_id, a.agence_nom, {
        type: 'baisse',
        texte: `Satisfaction ${signed(pts, ' pts')} vs période précédente`,
        portee: periode,
      });
    }
  }

  // 4. Issues critiques/élevées ouvertes nécessitant une action.
  const issuesParAgence = new Map<string, Issue[]>();
  for (const i of issuesOuvertes) {
    if (!i.necessite_action || (i.severite !== 'critique' && i.severite !== 'elevee')) continue;
    issuesParAgence.set(i.agence_id, [...(issuesParAgence.get(i.agence_id) ?? []), i]);
  }
  for (const [agenceId, issues] of issuesParAgence) {
    const nom = meta.get(agenceId)?.agence_nom ?? issues[0].agence_nom ?? 'Agence';
    const critiques = issues.filter((i) => i.severite === 'critique').length;
    ajouter(agenceId, nom, {
      type: 'issues',
      texte: `${issues.length} Issue${issues.length > 1 ? 's' : ''} à traiter${critiques ? ` (dont ${critiques} critique${critiques > 1 ? 's' : ''})` : ''}`,
      portee: 'en cours',
    });
  }

  // Tri : rang de la raison la plus prioritaire, puis nombre de raisons, puis nom (ordre stable et explicable).
  const toutes = [...parAgence.values()]
    .map((r) => ({ ...r, signaux: [...r.signaux].sort((x, y) => RANG[x.type] - RANG[y.type]) }))
    .sort((a, b) => a.rang - b.rang || b.signaux.length - a.signaux.length || a.agence_nom.localeCompare(b.agence_nom, 'fr'));

  return { lignes: toutes.slice(0, SURVEILLANCE.MAX_LIGNES), total: toutes.length };
}

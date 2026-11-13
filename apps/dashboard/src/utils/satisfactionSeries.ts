import type { EvolutionPoint } from '../types';
import { formaterDateAxe, dateCourte, libelleSemaine, lundiSemaineIso } from './formatNombre';

export interface SatisfactionChartPoint extends Omit<EvolutionPoint, 'satisfaction'> {
  satisfaction: number | null;
  sansAvis?: true;
}

export interface SatisfactionVolumePoint extends Omit<SatisfactionChartPoint, 'traites'> {
  recus: number | null;
  traites: number | null;
}

function cleSuivante(cle: string): string | null {
  const heure = /^(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(cle);
  if (heure) {
    const date = new Date(`${heure[1]}T${heure[2]}:00:00Z`);
    date.setUTCHours(date.getUTCHours() + 1);
    return `${date.toISOString().slice(0, 10)}-${date.toISOString().slice(11, 13)}`;
  }

  const jour = /^(\d{4}-\d{2}-\d{2})$/.exec(cle);
  if (jour) {
    const date = new Date(`${jour[1]}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  const semaine = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (semaine) {
    const annee = Number(semaine[1]);
    const numero = Number(semaine[2]);
    const lundi = new Date(Date.UTC(annee, 0, 4 + (numero - 1) * 7));
    lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7) + 7);
    const jeudi = new Date(lundi);
    jeudi.setUTCDate(jeudi.getUTCDate() + 3);
    const anneeIso = jeudi.getUTCFullYear();
    const premierJeudi = new Date(Date.UTC(anneeIso, 0, 4));
    premierJeudi.setUTCDate(premierJeudi.getUTCDate() - ((premierJeudi.getUTCDay() + 6) % 7) + 3);
    const numeroIso = 1 + Math.round((jeudi.getTime() - premierJeudi.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return `${anneeIso}-W${String(numeroIso).padStart(2, '0')}`;
  }

  return null;
}

/** Libellé d'un point vide inséré dans un trou : même forme que ceux de l'API (« 14h », « 4 août », lundi de la semaine). */
function libelleVide(cle: string, avecAnnee: boolean): string {
  const heure = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(cle);
  if (heure) return `${heure[4]}h`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(cle)) return formaterDateAxe(cle);
  const lundi = lundiSemaineIso(cle);
  if (lundi) return dateCourte(lundi.getUTCFullYear(), lundi.getUTCMonth() + 1, lundi.getUTCDate(), avecAnnee);
  return cle;
}

/**
 * L'API ne renvoie que les buckets avec au moins un avis. Insère donc des
 * points nuls uniquement dans les trous internes pour que le tracé s'interrompe
 * au lieu de suggérer une évolution continue sur une période sans observation.
 */
export function insererPeriodesSansAvis(points: EvolutionPoint[]): SatisfactionChartPoint[] {
  if (points.length < 2) return points;

  // L'API ajoute l'année aux libellés (« 29 déc. 2025 ») quand la série couvre deux années : les trous la portent aussi.
  const avecAnnee = points.some((p) => / \d{4}$/.test(p.label));
  const resultat: SatisfactionChartPoint[] = [];
  points.forEach((point, index) => {
    resultat.push(point);
    if (index === points.length - 1) return;

    let prochaine = cleSuivante(point.date);
    const cleCible = points[index + 1].date;
    // Limite de sûreté : les séquences sont courtes (≤ 365 jours).
    for (let garde = 0; prochaine && prochaine < cleCible && garde < 400; garde += 1) {
      resultat.push({
        date: prochaine,
        label: libelleVide(prochaine, avecAnnee),
        feedbacks: 0,
        traites: 0,
        satisfaction: null,
        positifs: 0,
        neutres: 0,
        negatifs: 0,
        sansAvis: true,
      });
      prochaine = cleSuivante(prochaine);
    }
  });
  return resultat;
}

/** Aligne les deux séries sur les périodes de satisfaction, sans inventer de volumes pendant les trous. */
export function combinerSatisfactionEtVolume(
  satisfaction: EvolutionPoint[],
  volume: EvolutionPoint[],
): SatisfactionVolumePoint[] {
  const volumeParDate = new Map(volume.map((point) => [point.date, point]));
  return insererPeriodesSansAvis(satisfaction).map((point) => {
    const volumePoint = volumeParDate.get(point.date);
    return {
      ...point,
      recus: point.sansAvis ? null : (volumePoint?.feedbacks ?? 0),
      traites: point.sansAvis ? null : (volumePoint?.traites ?? 0),
    };
  });
}

/** Infobulle : « 4 août 2026 », « 4 août 2026 · 14h », « Semaine du 3 au 9 août 2026 ». Jamais de numéro de semaine. */
export function libelleDatePoint(cle: string, libelle: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(cle)) return formaterDateAxe(cle, true);

  const heure = /^(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(cle);
  if (heure) return `${formaterDateAxe(heure[1], true)} · ${heure[2]}h`;

  const lundi = lundiSemaineIso(cle);
  if (lundi) return libelleSemaine(lundi);

  return libelle || cle;
}

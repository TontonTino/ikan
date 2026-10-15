import type { EvolutionPoint } from '../types';

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

function libelleVide(cle: string): string {
  const heure = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(cle);
  if (heure) return `${heure[4]}h`;
  const jour = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cle);
  if (jour) return `${jour[3]}/${jour[2]}`;
  const semaine = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (semaine) return `Sem ${Number(semaine[2])} ${semaine[1]}`;
  return cle;
}

/**
 * L'API ne renvoie que les buckets avec au moins un avis. Insère donc des
 * points nuls uniquement dans les trous internes pour que le tracé s'interrompe
 * au lieu de suggérer une évolution continue sur une période sans observation.
 */
export function insererPeriodesSansAvis(points: EvolutionPoint[]): SatisfactionChartPoint[] {
  if (points.length < 2) return points;

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
        label: libelleVide(prochaine),
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

export function libelleDatePoint(cle: string, libelle: string): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cle);
  if (date) return `${date[3]}/${date[2]}/${date[1]}`;

  const heure = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(cle);
  if (heure) return `${heure[3]}/${heure[2]}/${heure[1]} · ${heure[4]}h`;

  const semaine = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (semaine) {
    const lundi = new Date(Date.UTC(Number(semaine[1]), 0, 4 + (Number(semaine[2]) - 1) * 7));
    lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7));
    const dimanche = new Date(lundi);
    dimanche.setUTCDate(dimanche.getUTCDate() + 6);
    const format = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${libelle} · ${format(lundi)}–${format(dimanche)} ${dimanche.getUTCFullYear()}`;
  }

  return libelle || cle;
}

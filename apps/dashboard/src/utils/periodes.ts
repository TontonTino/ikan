/**
 * UNE seule liste de périodes pour tout le dashboard (lot 3) : 7 jours, 30 jours, 90 jours, 12 mois ; 30 jours par défaut.
 * Chaque sélecteur de période la lit ici. Un bloc qui ne peut pas suivre la période de sa page écrit la sienne dans son titre,
 * en toutes lettres (`libellePeriode`).
 */
export interface Periode {
  jours: number;
  /** Libellé court du sélecteur (« 30 jours », « 12 mois »). */
  label: string;
}

export const PERIODES: readonly Periode[] = [
  { jours: 7, label: '7 jours' },
  { jours: 30, label: '30 jours' },
  { jours: 90, label: '90 jours' },
  { jours: 365, label: '12 mois' },
];

export const PERIODE_PAR_DEFAUT = 30;

/** « 30 derniers jours », « 12 derniers mois » : la période en toutes lettres. */
export const libellePeriode = (jours: number): string => (jours === 365 ? '12 derniers mois' : `${jours} derniers jours`);

/** Une valeur reçue (URL, lien) ramenée à la liste : toute autre valeur donne la période par défaut. */
export const periodeConnue = (jours: number | string | null | undefined): number => {
  const n = Number(jours);
  return PERIODES.some((p) => p.jours === n) ? n : PERIODE_PAR_DEFAUT;
};

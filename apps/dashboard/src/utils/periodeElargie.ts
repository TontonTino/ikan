/** Une période proposée par une page (en jours) et son libellé affiché (« 30 jours », « 12 mois »…). */
export interface PeriodeChoix {
  jours: number;
  label: string;
}

/** Période immédiatement plus large parmi celles que la page propose, ou null si la page affiche déjà la plus large. */
export function periodePlusLarge(jours: number, options: PeriodeChoix[]): PeriodeChoix | null {
  return [...options].filter((o) => o.jours > jours).sort((a, b) => a.jours - b.jours)[0] ?? null;
}

/** Lien d'un graphique vide vers la période plus large (ou rien). */
export function elargirPeriode(jours: number, options: PeriodeChoix[], choisir: (jours: number) => void) {
  const suivante = periodePlusLarge(jours, options);
  return suivante ? { label: `Voir sur ${suivante.label.toLowerCase()}`, onClick: () => choisir(suivante.jours) } : undefined;
}

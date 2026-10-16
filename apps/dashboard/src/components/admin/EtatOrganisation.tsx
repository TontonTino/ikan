import React from 'react';

/** Conséquences affichées avant de désactiver une organisation (confirmation). */
export const TEXTE_CONFIRMATION_DESACTIVATION =
  'Les comptes de cette organisation ne pourront plus se connecter. Les données sont conservées.';

/** Rappel sous le texte de confirmation : la désactivation se défait. */
export const TEXTE_REACTIVATION_POSSIBLE = 'Vous pourrez la réactiver à tout moment : ses comptes se connecteront de nouveau.';

export const libelleEtatOrganisation = (active: boolean) => (active ? 'Active' : 'Désactivée');

/** Badge d'état : le texte porte l'information, la couleur n'est jamais le seul signal. */
export function BadgeEtatOrganisation({ active }: { active: boolean }) {
  return <span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}>{libelleEtatOrganisation(active)}</span>;
}

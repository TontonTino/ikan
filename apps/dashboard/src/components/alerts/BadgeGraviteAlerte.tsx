import React from 'react';
import Badge from '../ui/Badge';
import { AlertTriangleIcon, InfoIcon } from '../common/Icons';

export type GraviteAlerte = 'critique' | 'important';

export const LIBELLE_GRAVITE: Record<GraviteAlerte, string> = { critique: 'Critique', important: 'Important' };

/**
 * Gravité d'une alerte de satisfaction (AM-04) : libellé texte ET icône, jamais la couleur seule. Deux icônes différentes
 * (triangle d'alerte / information) pour que les deux niveaux se distinguent aussi sans les couleurs.
 * Sans gravité (ancien serveur) : rien n'est affiché, l'appelant garde son libellé d'origine.
 */
export default function BadgeGraviteAlerte({ gravite, size = 'sm' }: { gravite?: GraviteAlerte | null; size?: 'sm' | 'md' }) {
  if (gravite !== 'critique' && gravite !== 'important') return null;
  const critique = gravite === 'critique';
  return (
    <Badge
      variant={critique ? 'critical' : 'warning'}
      size={size}
      label={LIBELLE_GRAVITE[gravite]}
      icon={critique ? <AlertTriangleIcon size={12} /> : <InfoIcon size={12} />}
    />
  );
}

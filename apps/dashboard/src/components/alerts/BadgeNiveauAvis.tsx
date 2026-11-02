import React from 'react';
import Badge from '../ui/Badge';
import { AlertTriangleIcon, InfoIcon } from '../common/Icons';
import { tonAvis } from '../../pages/cx/alertesVue';

/** Libellés du niveau d'un avis à risque. Règle EXISTANTE de l'interface (alertesVue.tonAvis) : note ≤ 2 = « Critique », sinon « À surveiller ». */
export const LIBELLE_NIVEAU_AVIS = { critical: 'Critique', warning: 'À surveiller' } as const;

/**
 * Niveau d'un avis à risque en TEXTE et icône (jamais la couleur seule), comme `BadgeGraviteAlerte` pour les alertes de satisfaction :
 * triangle d'alerte pour « Critique », information pour « À surveiller ». Aucune règle nouvelle : le niveau vient de `tonAvis(note)`.
 */
export default function BadgeNiveauAvis({ note, size = 'sm' }: { note: number; size?: 'sm' | 'md' }) {
  const ton = tonAvis(note);
  return (
    <Badge
      variant={ton}
      size={size}
      label={LIBELLE_NIVEAU_AVIS[ton]}
      icon={ton === 'critical' ? <AlertTriangleIcon size={12} /> : <InfoIcon size={12} />}
    />
  );
}

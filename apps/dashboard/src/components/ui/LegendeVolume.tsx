import React from 'react';
import { FAIBLE_VOLUME_POINT } from '../../pages/cx/siege/siegeData';

/** Le même point que sur la courbe (plein ou creux), à la taille de la légende. */
function Point({ creux }: { creux: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4" fill={creux ? 'var(--color-surface)' : 'var(--dataviz-positive)'} stroke="var(--dataviz-positive)" strokeWidth="2" />
    </svg>
  );
}

/**
 * Légende des points d'une courbe de satisfaction : pourquoi certains sont pleins et d'autres creux.
 * Un point = une période (jour ou semaine). Calculé sur moins de FAIBLE_VOLUME_POINT avis, son pourcentage bouge beaucoup
 * avec un seul avis : il est dessiné creux, pour qu'on ne lui accorde pas le même poids. La forme dit la différence, pas
 * la couleur seule. Affichée seulement quand la courbe contient au moins un point creux.
 */
export default function LegendeVolume() {
  return (
    <span className="legende-volume">
      <span className="legende-volume__item"><Point creux={false} />{FAIBLE_VOLUME_POINT} avis ou plus</span>
      <span className="legende-volume__item"><Point creux />Moins de {FAIBLE_VOLUME_POINT} avis : à lire avec prudence</span>
    </span>
  );
}

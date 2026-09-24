import React from 'react';

export interface SkeletonBlockProps {
  width?: number | string;
  height?: number | string;
  /** Rayon de courbure (défaut : var(--radius-md)). */
  radius?: number | string;
  style?: React.CSSProperties;
}

/**
 * Rectangle de chargement (animation pulse légère, désactivée si l'utilisateur
 * préfère réduire les animations — voir .skeleton-block dans styles/global.css).
 * Sert à conserver la structure d'une page pendant le fetch plutôt que de la
 * remplacer par un texte "Chargement…".
 */
export default function SkeletonBlock({ width = '100%', height = 16, radius = 'var(--radius-md)', style }: SkeletonBlockProps) {
  return (
    <span
      className="skeleton-block"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

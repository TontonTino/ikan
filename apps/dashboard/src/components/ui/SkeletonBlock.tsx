import React from 'react';
import Skeleton from './Skeleton';

export interface SkeletonBlockProps {
  width?: number | string;
  height?: number | string;
  /** Rayon de courbure (défaut : var(--radius-md)). */
  radius?: number | string;
  style?: React.CSSProperties;
}

/**
 * @deprecated Alias historique de <Skeleton variant="rect" />, conservé pour
 * les pages existantes. Utiliser Skeleton dans le nouveau code.
 */
export default function SkeletonBlock({ width = '100%', height = 16, radius, style }: SkeletonBlockProps) {
  return <Skeleton variant="rect" width={width} height={height} radius={radius} style={style} />;
}

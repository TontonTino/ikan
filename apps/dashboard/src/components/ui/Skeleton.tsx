import React from 'react';

export interface SkeletonProps {
  variant?: 'rect' | 'text' | 'circle';
  width?: number | string;
  height?: number | string;
  /** Nombre de lignes (variant="text") : la dernière est raccourcie. */
  lines?: number;
  radius?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Placeholder de chargement. Reproduit la forme finale du contenu pour
 * éviter tout saut de layout. Pulse désactivé si prefers-reduced-motion.
 * Le conteneur parent porte aria-busy="true" ; le skeleton est masqué aux
 * technologies d'assistance.
 */
export default function Skeleton({ variant = 'rect', width = '100%', height, lines = 1, radius, className, style }: SkeletonProps) {
  const base = ['ui-skeleton', variant !== 'rect' && `ui-skeleton--${variant}`, className].filter(Boolean).join(' ');

  if (variant === 'text' && lines > 1) {
    return (
      <span className="ui-skeleton-lines" aria-hidden="true" style={{ width }}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={base} style={{ width: i === lines - 1 ? '62%' : '100%', height, borderRadius: radius, ...style }} />
        ))}
      </span>
    );
  }

  const h = height ?? (variant === 'circle' ? width : variant === 'text' ? undefined : 16);
  return <span className={base} aria-hidden="true" style={{ width, height: h, borderRadius: radius, ...style }} />;
}

import React from 'react';

/**
 * Grille bento : compose un dashboard en zones de tailles différentes selon
 * l'importance de l'information (pas une liste de cartes identiques).
 *
 * 12 colonnes, responsive par CONTAINER QUERIES (largeur réelle disponible,
 * donc réactive à la sidebar réduite/ouverte), 3 paliers :
 *   sm  < 640 px  : pleine largeur, empilé dans l'ordre du DOM (sauf KPI : 2 par ligne)
 *   md  ≥ 640 px  : 2 colonnes logiques
 *   lg  ≥ 1024 px : composition complète (spans + hauteurs sur 2 rangées)
 *
 * L'ordre du DOM = ordre de lecture (clavier, lecteur d'écran, mobile) :
 * placer les zones dans l'ordre de la hiérarchie Situation → Évolution →
 * Priorités → Explication → Action → Impact.
 */

export type BentoPreset =
  /** KPI de synthèse : 1/4 en lg, 1/2 en md et sm (lecture en 2×2 sur mobile). */
  | 'kpi'
  /** Graphique principal : 2/3 en lg sur 2 rangées, pleine largeur en md. */
  | 'hero'
  /** Colonne latérale (alertes, insights) : 1/3 en lg, 1/2 en md. */
  | 'side'
  /** Colonne latérale haute (2 rangées) : 1/3 en lg, pleine largeur en md. */
  | 'side-tall'
  /** Moitié : 1/2 en lg et md. */
  | 'half'
  /** Tiers : 1/3 en lg, 1/2 en md. */
  | 'third'
  /** Deux tiers : 2/3 en lg, pleine largeur en md. */
  | 'two-thirds'
  /** Pleine largeur partout. */
  | 'full';

type Spans = { md: number; lg: number; rows?: number; /** Colonnes sur 12 sous 640 px (défaut 12 : empilé). */ sm?: number };

const PRESETS: Record<BentoPreset, Spans> = {
  kpi: { sm: 6, md: 6, lg: 3 },
  hero: { md: 12, lg: 8, rows: 2 },
  side: { md: 6, lg: 4 },
  'side-tall': { md: 12, lg: 4, rows: 2 },
  half: { md: 6, lg: 6 },
  third: { md: 6, lg: 4 },
  'two-thirds': { md: 12, lg: 8 },
  full: { md: 12, lg: 12 },
};

export interface BentoGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Espacement entre zones (défaut : --space-4). */
  gap?: 'sm' | 'md' | 'lg';
}

export function BentoGrid({ children, gap = 'md', className, ...rest }: BentoGridProps) {
  return (
    <div className={['ui-bento', className].filter(Boolean).join(' ')} {...rest}>
      <div className={`ui-bento__grid ui-bento__grid--gap-${gap}`}>{children}</div>
    </div>
  );
}

export interface BentoItemProps extends React.HTMLAttributes<HTMLElement> {
  /** Gabarit de taille. */
  size?: BentoPreset;
  /** Surcharge fine des colonnes (sur 12) et des rangées en lg. */
  span?: Partial<Spans>;
  /** Élément rendu (section par défaut : chaque zone est un repère de navigation). */
  as?: 'section' | 'div' | 'article' | 'aside';
  children: React.ReactNode;
}

export function BentoItem({ size = 'third', span, as = 'section', className, style, children, ...rest }: BentoItemProps) {
  const s = { ...PRESETS[size], ...span };
  const Tag = as as React.ElementType;
  return (
    <Tag
      className={['ui-bento__item', className].filter(Boolean).join(' ')}
      style={{ '--bento-sm': s.sm ?? 12, '--bento-md': s.md, '--bento-lg': s.lg, '--bento-rows': s.rows ?? 1, ...style } as React.CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default BentoGrid;

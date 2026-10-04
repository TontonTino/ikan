import React from 'react';

/**
 * Badge — statut, criticité, sentiment, thème.
 *
 * Tons sémantiques (tokens.css, contraste texte/fond ≥ 4.5:1) :
 *   success · warning · critical · info · neutral · brand · outline
 *
 * Variantes métier (compat. API historique) mappées sur un ton :
 *   critique → critical   elevee → warning   moyenne → brand   faible → neutral
 *   positif  → success    neutre → warning   negatif → critical
 *   info → info           default → brand
 *
 * Le libellé est toujours affiché : la couleur ne porte jamais seule l'information.
 */
export type BadgeTone = 'success' | 'warning' | 'critical' | 'info' | 'neutral' | 'brand' | 'outline';
type BusinessVariant = 'critique' | 'elevee' | 'moyenne' | 'faible' | 'positif' | 'neutre' | 'negatif' | 'info' | 'default';
export type BadgeVariant = BusinessVariant | BadgeTone;

const TONE_OF: Record<BadgeVariant, BadgeTone> = {
  critique: 'critical',
  elevee: 'warning',
  moyenne: 'brand',
  faible: 'neutral',
  positif: 'success',
  neutre: 'warning',
  negatif: 'critical',
  info: 'info',
  default: 'brand',
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  neutral: 'neutral',
  brand: 'brand',
  outline: 'outline',
};

export interface BadgeProps {
  /** Contenu textuel */
  label: string;
  /** Variante (métier ou ton sémantique) */
  variant?: BadgeVariant;
  /**
   * Valeur backend brute, mappée automatiquement (insensible à la casse).
   * Prioritaire sur `variant`.
   */
  value?: string;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  className?: string;
}

function toVariant(v?: string): BadgeVariant {
  if (!v) return 'default';
  const low = v.toLowerCase();
  if (low in TONE_OF) return low as BadgeVariant;
  if (low === 'high' || low === 'haute' || low === 'elevée' || low === 'élevée') return 'elevee';
  if (low === 'medium' || low === 'modérée') return 'moyenne';
  if (low === 'low' || low === 'bas' || low === 'basse') return 'faible';
  if (low === 'critical') return 'critique';
  if (low === 'positive') return 'positif';
  if (low === 'negative' || low === 'négatif') return 'negatif';
  if (low === 'neutral') return 'neutre';
  return 'default';
}

export default function Badge({ label, variant, value, size = 'sm', icon, className }: BadgeProps) {
  const resolved = value ? toVariant(value) : (variant ?? 'default');
  const classes = ['ui-badge', `ui-badge--${TONE_OF[resolved]}`, size === 'md' && 'ui-badge--md', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {icon && <span className="ui-badge__icon" aria-hidden="true">{icon}</span>}
      {label}
    </span>
  );
}

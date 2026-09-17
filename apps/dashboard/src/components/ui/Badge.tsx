import React from 'react';

/**
 * Badge — variantes criticité / sentiment / thème
 *
 * Règles WCAG (tokens.css) :
 *   CRITIQUE  → --ikan-danger   sur --ikan-danger-bg
 *   ELEVEE    → --ikan-warning  sur --ikan-warning-bg
 *   MOYENNE   → --ikan-ink      sur --ikan-lime-soft
 *   FAIBLE    → --ikan-text-soft sur fond gris-crème
 *   positif   → --ikan-success  sur --ikan-success-bg
 *   neutre    → #B45309         sur #FEF3C7
 *   negatif   → --ikan-danger   sur --ikan-danger-bg
 */

// ── Palettes ──────────────────────────────────────────────────────
type BadgeVariant =
  | 'critique' | 'elevee' | 'moyenne' | 'faible'
  | 'positif' | 'neutre' | 'negatif'
  | 'info' | 'default';

const PALETTE: Record<
  BadgeVariant,
  { bg: string; text: string; border?: string }
> = {
  critique: {
    bg:   'var(--ikan-danger-bg)',
    text: 'var(--ikan-danger)',
    border: 'rgba(196,61,47,0.18)',
  },
  elevee: {
    bg:   'var(--ikan-warning-bg)',
    text: 'var(--ikan-warning)',
    border: 'rgba(217,126,31,0.18)',
  },
  moyenne: {
    bg:   'var(--ikan-lime-soft)',
    text: 'var(--ikan-ink)',
    border: 'rgba(188,207,0,0.25)',
  },
  faible: {
    bg:   'var(--ikan-bg)',
    text: 'var(--ikan-text-soft)',
    border: 'var(--ikan-border)',
  },
  positif: {
    bg:   'var(--ikan-success-bg)',
    text: 'var(--ikan-success)',
    border: 'rgba(60,119,48,0.18)',
  },
  neutre: {
    bg:   '#FEF3C7',
    text: '#B45309',
    border: '#FDE68A',
  },
  negatif: {
    bg:   'var(--ikan-danger-bg)',
    text: 'var(--ikan-danger)',
    border: 'rgba(196,61,47,0.18)',
  },
  info: {
    bg:   '#E0F2FE',
    text: '#0369A1',
    border: '#BAE6FD',
  },
  default: {
    bg:   'var(--ikan-primary-soft)',
    text: 'var(--ikan-primary)',
    border: 'rgba(60,119,48,0.18)',
  },
};

// ── Props ────────────────────────────────────────────────────────
export interface BadgeProps {
  /** Contenu textuel */
  label: string;
  /** Variante de couleur */
  variant?: BadgeVariant;
  /**
   * Alias pratique pour les valeurs backend :
   * mappé automatiquement sur une variante (case-insensitive).
   * Prioritaire sur `variant`.
   */
  value?: string;
  /** Taille du texte */
  size?: 'sm' | 'md';
  /** Icône optionnelle */
  icon?: React.ReactNode;
}

function toVariant(v?: string): BadgeVariant {
  if (!v) return 'default';
  const low = v.toLowerCase();
  if (low in PALETTE) return low as BadgeVariant;
  // Alias secondaires
  if (low === 'high' || low === 'haute' || low === 'elevée') return 'elevee';
  if (low === 'medium' || low === 'modérée') return 'moyenne';
  if (low === 'low' || low === 'bas' || low === 'basse') return 'faible';
  if (low === 'critical') return 'critique';
  if (low === 'positive' || low === 'positif') return 'positif';
  if (low === 'negative' || low === 'négatif' || low === 'negatif') return 'negatif';
  if (low === 'neutral' || low === 'neutre') return 'neutre';
  return 'default';
}

// ── Composant ────────────────────────────────────────────────────
export default function Badge({
  label,
  variant,
  value,
  size = 'sm',
  icon,
}: BadgeProps) {
  const resolved = value ? toVariant(value) : (variant ?? 'default');
  const { bg, text, border } = PALETTE[resolved];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        background: bg,
        color: text,
        border: `1px solid ${border ?? 'transparent'}`,
        borderRadius: 'var(--ikan-radius-pill)',
        padding: size === 'md' ? '4px 12px' : '3px 9px',
        fontSize: size === 'md' ? '0.82rem' : '0.74rem',
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
      }}
    >
      {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      {label}
    </span>
  );
}

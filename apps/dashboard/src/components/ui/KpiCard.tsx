import React from 'react';
import { ArrowDownRightIcon, ArrowUpRightIcon } from '../common/Icons';
import Skeleton from './Skeleton';
import Tooltip from './Tooltip';

export type KpiTone = 'positive' | 'critical' | 'warning' | 'neutral';

export interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: {
    /** Delta affiché tel quel (ex. "+3 pts", "-12 %"). */
    value: string;
    /**
     * Valence : l'évolution est-elle favorable ? (vert si true, rouge si false).
     * Distincte du sens : une baisse des feedbacks critiques est favorable.
     */
    isPositive?: boolean;
    /** Sens de la variation. Déduit de `value` (+/-) si absent. */
    direction?: 'up' | 'down' | 'flat';
    period?: string;
  };
  /** Série réelle (ordre chronologique) pour la sparkline. Aucune sparkline sans données. */
  sparkline?: number[];
  /** Ton de la carte. Prioritaire sur `badgeColor`. */
  tone?: KpiTone;
  /** @deprecated utiliser `tone` (green → positive, red → critical, neutral → neutral). */
  badgeColor?: 'green' | 'red' | 'neutral';
  subtitle?: string;
  /** Progressive Disclosure : ouvre le détail du KPI. Rend la carte activable au clavier. */
  onClick?: () => void;
  compact?: boolean;
  /** Explication du calcul (affichée en tooltip à côté du libellé). */
  hint?: string;
  loading?: boolean;
  /** Met en avant CE KPI (un seul par page) : barre lime décorative sous la valeur. */
  highlight?: boolean;
  /** @deprecated la vague décorative a été retirée : seule `sparkline` (données réelles) est tracée. */
  showSparkline?: boolean;
  /** @deprecated voir `showSparkline`. */
  sparklineType?: 'up' | 'down' | 'neutral';
}

function Sparkline({ data, width, height }: { data: number[]; width: number; height: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="ui-kpi__spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true">
      <path d={line} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="currentColor" />
    </svg>
  );
}

function resolveTone(tone?: KpiTone, badgeColor?: KpiCardProps['badgeColor'], trendPositive?: boolean): KpiTone {
  if (tone) return tone;
  if (badgeColor === 'red') return 'critical';
  if (badgeColor === 'neutral') return 'neutral';
  if (trendPositive === false) return 'critical';
  return 'positive';
}

function resolveDirection(trend: NonNullable<KpiCardProps['trend']>): 'up' | 'down' | 'flat' {
  if (trend.direction) return trend.direction;
  const v = trend.value.trim();
  if (v.startsWith('-') || v.startsWith('−')) return 'down';
  if (v.startsWith('+')) return 'up';
  if (/^0([.,]0+)?(\s|%|$)/.test(v)) return 'flat';
  return trend.isPositive === false ? 'down' : 'up';
}

/**
 * KPI de synthèse : valeur + évolution + delta + sparkline.
 * Le sens de l'évolution est porté par flèche + signe + texte, jamais par la couleur seule.
 */
export default function KpiCard({
  icon,
  label,
  value,
  trend,
  sparkline,
  tone,
  badgeColor,
  subtitle,
  onClick,
  compact = false,
  hint,
  loading = false,
  highlight = false,
}: KpiCardProps) {
  const resolvedTone = resolveTone(tone, badgeColor, trend?.isPositive);
  const direction = trend ? resolveDirection(trend) : 'flat';
  const deltaClass = !trend ? '' : trend.isPositive === false ? 'down' : direction === 'flat' ? 'flat' : 'up';
  // Pas de période de comparaison affichée sans delta : elle suggérerait une comparaison inexistante.
  const period = trend ? trend.period || subtitle || 'vs. mois dernier' : subtitle;
  const iconSize = compact ? 14 : 20;

  const classes = [
    'ui-card',
    'ui-kpi',
    `ui-kpi--${resolvedTone}`,
    compact && 'ui-kpi--compact',
    onClick && 'ui-card--interactive',
  ]
    .filter(Boolean)
    .join(' ');

  if (loading) {
    return (
      <div className={classes} aria-busy="true" aria-label={`${label} : chargement`}>
        <div className="ui-kpi__top">
          <div className="ui-kpi__label-wrap">
            <Skeleton variant="rect" width={compact ? 28 : 40} height={compact ? 28 : 40} />
            <Skeleton variant="text" width={110} />
          </div>
        </div>
        <Skeleton variant="text" width="45%" height={compact ? 24 : 32} />
        <Skeleton variant="text" width="60%" />
      </div>
    );
  }

  const interactiveProps = onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
        'aria-label': `${label} : ${value}. Voir le détail`,
      }
    : {};

  const DirIcon = direction === 'down' ? ArrowDownRightIcon : ArrowUpRightIcon;

  return (
    <div className={classes} {...interactiveProps}>
      <div className="ui-kpi__top">
        <div className="ui-kpi__label-wrap">
          <span className="ui-kpi__icon" aria-hidden="true">
            {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: iconSize }) : icon}
          </span>
          <span className="ui-kpi__label">{label}</span>
          {hint && (
            <Tooltip content={hint}>
              <button
                type="button"
                className="ui-info-btn"
                aria-label={`À propos : ${label}`}
                // L'aide ne doit pas déclencher l'ouverture du détail de la carte.
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                ?
              </button>
            </Tooltip>
          )}
        </div>
        {sparkline && <Sparkline data={sparkline} width={compact ? 48 : 72} height={compact ? 18 : 26} />}
      </div>

      <div>
        <div className="ui-kpi__value">{value}</div>
        {highlight && <div className="ui-kpi__accent" aria-hidden="true" />}
      </div>

      <div className="ui-kpi__bottom">
        {trend && (
          <span className={`ui-kpi__delta ui-kpi__delta--${deltaClass}`}>
            {direction !== 'flat' && <DirIcon size={compact ? 10 : 12} aria-hidden="true" />}
            <span>{trend.value}</span>
            <span className="ui-sr-only">
              {trend.isPositive === false ? ', évolution défavorable' : direction === 'flat' ? ', stable' : ', évolution favorable'}
            </span>
          </span>
        )}
        {period && <span className="ui-kpi__period">{period}</span>}
      </div>
    </div>
  );
}

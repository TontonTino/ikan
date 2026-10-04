import React, { useState } from 'react';
import Card from './Card';
import Button from './Button';
import EmptyState from './EmptyState';
import Skeleton from './Skeleton';

/**
 * Couleurs dataviz — sens FIXE (tokens.css) :
 *   positive = satisfaction/succès · critical = critique · attention = à surveiller
 *   info = volume/information · neutral = série de référence (période précédente…)
 * 3-4 séries max par graphique. Les variables CSS fonctionnent dans les
 * attributs SVG de Recharts (stroke/fill).
 */
export const DATAVIZ = {
  positive: 'var(--dataviz-positive)',
  critical: 'var(--dataviz-critical)',
  attention: 'var(--dataviz-attention)',
  info: 'var(--dataviz-info)',
  neutral: 'var(--dataviz-neutral)',
} as const;
export type DatavizColor = keyof typeof DATAVIZ;

/** Props communes des axes Recharts : grille et axes discrets, texte lisible. */
export const chartAxisProps = {
  stroke: 'var(--dataviz-grid)',
  tick: { fill: 'var(--dataviz-axis)', fontSize: 12, fontWeight: 600 },
  tickLine: false,
  axisLine: false,
} as const;
export const chartGridProps = { stroke: 'var(--dataviz-grid)', strokeDasharray: '0', vertical: false } as const;

export interface ChartSeries {
  key: string;
  label: string;
  color: DatavizColor;
  /** Série de référence (période précédente, moyenne réseau) : trait pointillé. */
  dashed?: boolean;
}

export type Granularity = 'day' | 'week' | 'month';
const GRANULARITY_LABEL: Record<Granularity, string> = { day: 'Jour', week: 'Semaine', month: 'Mois' };

export interface ChartProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Séries affichées en légende interactive (clic = masquer/afficher). */
  series?: ChartSeries[];
  height?: number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** true quand il n'y a rien à tracer : remplace le graphique par un message clair. */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  granularity?: {
    value: Granularity;
    options?: Granularity[];
    onChange: (g: Granularity) => void;
  };
  /** Vue tableau des mêmes données (accessibilité, lecture exacte). */
  table?: React.ReactNode;
  /** Actions supplémentaires d'en-tête. */
  actions?: React.ReactNode;
  /** Contenu Recharts. Reçoit la visibilité des séries. */
  children: (ctx: { isVisible: (key: string) => boolean; color: (c: DatavizColor) => string }) => React.ReactNode;
  className?: string;
}

/**
 * Cadre commun des graphiques : titre, granularité, légende interactive,
 * états chargement / vide / erreur, bascule tableau. Le tracé reste en Recharts.
 */
export default function Chart({
  title,
  subtitle,
  series = [],
  height = 260,
  loading = false,
  error,
  onRetry,
  isEmpty = false,
  emptyTitle = 'Aucune donnée sur cette période.',
  emptyMessage,
  granularity,
  table,
  actions,
  children,
  className,
}: ChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showTable, setShowTable] = useState(false);

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      // On ne masque jamais la dernière série visible.
      else if (series.length - prev.size > 1) next.add(key);
      return next;
    });

  const headerActions = (
    <>
      {granularity && (
        <div className="ui-segmented" role="group" aria-label="Granularité">
          {(granularity.options ?? (['day', 'week', 'month'] as Granularity[])).map((g) => (
            <button
              key={g}
              type="button"
              className="ui-segmented__item"
              aria-pressed={granularity.value === g}
              onClick={() => granularity.onChange(g)}
            >
              {GRANULARITY_LABEL[g]}
            </button>
          ))}
        </div>
      )}
      {table && !loading && !isEmpty && !error && (
        <Button size="sm" variant="ghost" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Voir le graphique' : 'Voir les données'}
        </Button>
      )}
      {actions}
    </>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <Skeleton variant="rect" height={height} />;
  } else if (error) {
    body = (
      <div style={{ height }}>
        <EmptyState compact title="Impossible de charger ce graphique." message={error} action={onRetry ? { label: 'Réessayer', onClick: onRetry } : undefined} />
      </div>
    );
  } else if (isEmpty) {
    body = (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState compact title={emptyTitle} message={emptyMessage} />
      </div>
    );
  } else if (showTable && table) {
    body = table;
  } else {
    body = (
      <div className="ui-chart__plot" style={{ height }}>
        {children({ isVisible: (k) => !hidden.has(k), color: (c) => DATAVIZ[c] })}
      </div>
    );
  }

  return (
    <Card title={title} subtitle={subtitle} actions={headerActions} className={className} aria-busy={loading || undefined}>
      {series.length > 1 && !loading && !isEmpty && !error && !showTable && (
        <ul className="ui-chart__legend" aria-label="Légende — cliquer pour masquer ou afficher une série">
          {series.map((s) => (
            <li key={s.key}>
              <button type="button" className="ui-chart__legend-item" aria-pressed={!hidden.has(s.key)} onClick={() => toggle(s.key)}>
                <span
                  className={`ui-chart__legend-swatch${s.dashed ? ' ui-chart__legend-swatch--dashed' : ''}`}
                  style={s.dashed ? { borderColor: DATAVIZ[s.color] } : { background: DATAVIZ[s.color] }}
                  aria-hidden="true"
                />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {body}
    </Card>
  );
}

/** Tooltip Recharts du design system : `<Tooltip content={<ChartTooltip formatter={…} />} />`. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
  formatter?: (value: number | string, key: string) => string;
  labelFormatter?: (label: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ui-chart-tooltip">
      {label != null && <p className="ui-chart-tooltip__label">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="ui-chart-tooltip__row">
          <span className="ui-chart-tooltip__name">
            <span className="ui-chart__legend-swatch" style={{ background: p.color }} aria-hidden="true" />
            {p.name}
          </span>
          <span className="ui-chart-tooltip__value">
            {p.value == null ? '—' : formatter ? formatter(p.value, String(p.dataKey)) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

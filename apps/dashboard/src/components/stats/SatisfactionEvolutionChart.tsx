import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EvolutionPoint } from '../../types';
import { insererPeriodesSansAvis, libelleDatePoint, type SatisfactionChartPoint } from '../../utils/satisfactionSeries';
import GraphiqueVide, { type ElargirPeriode } from '../ui/GraphiqueVide';
import { formaterPourcentage } from '../../utils/formatNombre';

interface SatisfactionEvolutionChartProps {
  data: EvolutionPoint[];
  height?: number;
  /** Aucune donnée : lien vers une période plus large. */
  elargir?: ElargirPeriode;
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const pt = payload[0].payload as SatisfactionChartPoint;
    if (pt.sansAvis) return null;
    return (
      <div
        style={{
          background: 'var(--color-surface)',
          color: 'var(--color-encre)',
          padding: '10px 14px',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--text-xs)',
          boxShadow: 'var(--shadow-dropdown)',
          border: '1px solid var(--color-trait)',
        }}
      >
        <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: '4px', color: 'var(--color-encre)' }}>
          {libelleDatePoint(pt.date, pt.label || label)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="t-2">Satisfaction :</span>
          <span className="t-semi t-sm">{formaterPourcentage(pt.satisfaction)}</span>
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', marginTop: '4px' }}>
          {pt.feedbacks} avis ({pt.positifs} positifs, {pt.neutres} neutres, {pt.negatifs} négatifs)
        </div>
      </div>
    );
  }
  return null;
}

export default function SatisfactionEvolutionChart({
  data,
  height = 260,
  elargir,
}: SatisfactionEvolutionChartProps) {
  if (!data || data.length === 0) {
    return <GraphiqueVide message="Aucune donnée de satisfaction disponible pour cette période." elargir={elargir} />;
  }

  return (
    <div style={{ width: '100%', height: `${height}px` }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={insererPeriodesSansAvis(data)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--dataviz-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--color-text-2)"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-trait)' }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => formaterPourcentage(Number(v), 0)}
            stroke="var(--color-text-2)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="linear"
            dataKey="satisfaction"
            stroke="var(--color-bon-texte)"
            strokeWidth={2}
            connectNulls={false}
            dot={{ r: 3, fill: 'var(--color-bon-texte)', stroke: 'var(--color-text-inverse)', strokeWidth: 1 }}
            activeDot={{ r: 5, fill: 'var(--color-encre)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

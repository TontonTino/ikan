import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { EvolutionPoint } from '../../types';
import { libelleDatePoint } from '../../utils/satisfactionSeries';

interface VolumeEvolutionChartProps {
  data: EvolutionPoint[];
  height?: number;
  showTreated?: boolean;
  receivedLabel?: string;
  treatedLabel?: string;
  emptyMessage?: string;
}

function CustomTooltip({ active, payload, label, receivedLabel, treatedLabel }: any) {
  if (active && payload && payload.length) {
    const pt = payload[0].payload as EvolutionPoint;
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
        <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: '6px', color: 'var(--color-encre)' }}>
          {libelleDatePoint(pt.date, pt.label || label)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span className="t-2">{receivedLabel} :</span>
            <strong className="t-encre">{pt.feedbacks}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span className="t-2">{treatedLabel} :</span>
            <strong className="t-encre">{pt.traites}</strong>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

export default function VolumeEvolutionChart({
  data,
  height = 260,
  showTreated = true,
  receivedLabel = 'Avis critiques ou négatifs reçus',
  treatedLabel = "Pris en charge par l'agence",
  emptyMessage = 'Aucun avis critique ou négatif enregistré pour cette période.',
}: VolumeEvolutionChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-2)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-bg)',
          borderRadius: '16px',
          border: '1px dashed var(--color-trait)',
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: `${height}px` }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--dataviz-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--color-text-2)"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-trait)' }}
          />
          <YAxis
            stroke="var(--color-text-2)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip receivedLabel={receivedLabel} treatedLabel={treatedLabel} />} />
          {showTreated && <Legend wrapperStyle={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', paddingTop: 8 }} />}
          <Bar
            name={receivedLabel}
            dataKey="feedbacks"
            fill="var(--color-bon-texte)"
            radius={[6, 6, 0, 0]}
            maxBarSize={36}
          />
          {showTreated && (
            <Bar
              name={treatedLabel}
              dataKey="traites"
              fill="var(--color-encre)"
              radius={[6, 6, 0, 0]}
              maxBarSize={36}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

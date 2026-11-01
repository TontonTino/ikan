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
          background: '#02302D',
          color: '#FFFFFF',
          padding: '10px 14px',
          borderRadius: '12px',
          fontSize: '0.80rem',
          boxShadow: '0 8px 24px rgba(2, 48, 45, 0.25)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: '6px', color: '#E2F2E5' }}>
          {libelleDatePoint(pt.date, pt.label || label)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: '#94A3B8' }}>{receivedLabel} :</span>
            <strong style={{ color: '#FFFFFF' }}>{pt.feedbacks}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: '#75B72A' }}>{treatedLabel} :</span>
            <strong style={{ color: '#75B72A' }}>{pt.traites}</strong>
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
          color: '#5B6B7F',
          fontSize: '0.84rem',
          background: '#FAFCFA',
          borderRadius: '16px',
          border: '1px dashed #D6E8D9',
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
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#5B6B7F"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: '#E2E8F0' }}
          />
          <YAxis
            stroke="#5B6B7F"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip receivedLabel={receivedLabel} treatedLabel={treatedLabel} />} />
          {showTreated && <Legend wrapperStyle={{ fontSize: 12, color: '#475569', paddingTop: 8 }} />}
          <Bar
            name={receivedLabel}
            dataKey="feedbacks"
            fill="#3C7730"
            radius={[6, 6, 0, 0]}
            maxBarSize={36}
          />
          {showTreated && (
            <Bar
              name={treatedLabel}
              dataKey="traites"
              fill="#02302D"
              radius={[6, 6, 0, 0]}
              maxBarSize={36}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

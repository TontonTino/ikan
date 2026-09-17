import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EvolutionPoint } from '../../types';

interface SatisfactionEvolutionChartProps {
  data: EvolutionPoint[];
  height?: number;
}

function CustomTooltip({ active, payload, label }: any) {
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
        <div style={{ fontWeight: 700, marginBottom: '4px', color: '#E2F2E5' }}>
          {pt.label || label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#75B72A', fontWeight: 800 }}>Satisfaction :</span>
          <span style={{ fontWeight: 800, fontSize: '0.90rem' }}>{pt.satisfaction}%</span>
        </div>
        <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '4px' }}>
          {pt.feedbacks} avis ({pt.positifs} pos, {pt.neutres} neu, {pt.negatifs} nég)
        </div>
      </div>
    );
  }
  return null;
}

export default function SatisfactionEvolutionChart({
  data,
  height = 260,
}: SatisfactionEvolutionChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94A3B8',
          fontSize: '0.84rem',
          background: '#FAFCFA',
          borderRadius: '16px',
          border: '1px dashed #D6E8D9',
        }}
      >
        Aucune donnée de satisfaction disponible pour cette période.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: `${height}px` }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="satGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3C7730" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#3C7730" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#94A3B8"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: '#E2E8F0' }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            unit="%"
            stroke="#94A3B8"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="satisfaction"
            stroke="#3C7730"
            strokeWidth={2.5}
            fillOpacity={1}
            fill="url(#satGradient)"
            activeDot={{ r: 5, fill: '#02302D', stroke: '#75B72A', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

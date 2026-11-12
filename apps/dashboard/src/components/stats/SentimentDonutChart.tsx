import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formaterPourcentage } from '../../utils/formatNombre';

export interface SentimentItem {
  sentiment: string;
  count: number;
  pourcentage: number;
}

interface SentimentDonutChartProps {
  data: SentimentItem[];
  height?: number;
}

const SENTIMENT_META: Record<string, { label: string; color: string; bg: string }> = {
  positif: { label: 'Positif', color: 'var(--color-bon-texte)', bg: 'var(--color-bon-fond)' },
  neutre: { label: 'Neutre', color: 'var(--color-neutre-texte)', bg: 'var(--color-neutre-fond)' },
  negatif: { label: 'Négatif', color: 'var(--color-critique-texte)', bg: 'var(--color-critique-fond)' },
};

export default function SentimentDonutChart({
  data,
  height = 240,
}: SentimentDonutChartProps) {
  const total = data.reduce((acc, curr) => acc + curr.count, 0);

  if (total === 0) {
    return (
      <div
        style={{
          height: `${height}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-2)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-bg)',
          borderRadius: '16px',
          border: '1px dashed var(--color-trait)',
        }}
      >
        Aucun avis analysé pour cette période.
      </div>
    );
  }

  return (
    <div
      className="stats-cx__donut"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '20px',
        width: '100%',
        height: `${height}px`,
        flexWrap: 'wrap',
      }}
    >
      {/* Donut Chart */}
      <div style={{ flex: 1, minWidth: '160px', height: '100%', position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={54}
              outerRadius={78}
              paddingAngle={4}
              dataKey="count"
              nameKey="sentiment"
            >
              {data.map((entry, index) => {
                const sKey = entry.sentiment.toLowerCase();
                const color = SENTIMENT_META[sKey]?.color || 'var(--color-text-2)';
                return <Cell key={`cell-${index}`} fill={color} stroke="var(--color-text-inverse)" strokeWidth={2} />;
              })}
            </Pie>
            <Tooltip
              formatter={(value: any, name: any) => {
                const sKey = String(name).toLowerCase();
                const meta = SENTIMENT_META[sKey];
                return [`${value} avis`, meta?.label || name];
              }}
              contentStyle={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-trait)',
                boxShadow: 'var(--shadow-dropdown)',
                color: 'var(--color-encre)',
                fontSize: 'var(--text-xs)',
              }}
              itemStyle={{ color: 'var(--color-encre)' }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center Label */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', lineHeight: 1 }}>
            {total}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-2)', marginTop: '2px' }}>
            Avis
          </div>
        </div>
      </div>

      {/* Legend & Percentages */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          minWidth: '150px',
        }}
      >
        {data.map((item) => {
          const sKey = item.sentiment.toLowerCase();
          const meta = SENTIMENT_META[sKey] || {
            label: item.sentiment,
            color: 'var(--color-text-2)',
            bg: 'var(--color-neutre-fond)',
          };
          return (
            <div
              key={item.sentiment}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                background: meta.bg,
                borderRadius: '10px',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: meta.color,
                  }}
                />
                <span className="t-xs t-semi t-encre">
                  {meta.label}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                <strong style={{ fontSize: 'var(--text-sm)', color: meta.color }}>
                  {formaterPourcentage(item.pourcentage)}
                </strong>
                <span className="t-xs t-2">
                  ({item.count})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

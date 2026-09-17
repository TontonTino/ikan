import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

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
  positif: { label: 'Positif', color: '#3C7730', bg: '#EBF6ED' },
  neutre: { label: 'Neutre', color: '#F59E0B', bg: '#FEF3C7' },
  negatif: { label: 'Négatif', color: '#DC2626', bg: '#FEE2E2' },
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
          color: '#94A3B8',
          fontSize: '0.84rem',
          background: '#FAFCFA',
          borderRadius: '16px',
          border: '1px dashed #D6E8D9',
        }}
      >
        Aucun sentiment analysé pour cette période.
      </div>
    );
  }

  return (
    <div
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
                const color = SENTIMENT_META[sKey]?.color || '#94A3B8';
                return <Cell key={`cell-${index}`} fill={color} stroke="#FFFFFF" strokeWidth={2} />;
              })}
            </Pie>
            <Tooltip
              formatter={(value: any, name: any) => {
                const sKey = String(name).toLowerCase();
                const meta = SENTIMENT_META[sKey];
                return [`${value} avis`, meta?.label || name];
              }}
              contentStyle={{
                background: '#02302D',
                borderRadius: '10px',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.78rem',
              }}
              itemStyle={{ color: '#E2F2E5' }}
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
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#02302D', lineHeight: 1 }}>
            {total}
          </div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748B', marginTop: '2px' }}>
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
            color: '#64748B',
            bg: '#F1F5F9',
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
                <span style={{ fontSize: '0.80rem', fontWeight: 700, color: '#0F172A' }}>
                  {meta.label}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                <strong style={{ fontSize: '0.86rem', color: meta.color }}>
                  {item.pourcentage}%
                </strong>
                <span style={{ fontSize: '0.70rem', color: '#64748B' }}>
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

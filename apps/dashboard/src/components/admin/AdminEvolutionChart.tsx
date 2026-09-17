import React, { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type { ActivityPoint } from '../../types';
import { CalendarIcon } from '../common/Icons';

interface AdminEvolutionChartProps {
  activity7d?: ActivityPoint[];
  activity30d?: ActivityPoint[];
  activity90d?: ActivityPoint[];
  totalFeedbacks?: number;
  processedFeedbacks?: number;
  satisfactionRate?: string;
}

export default function AdminEvolutionChart({
  activity7d = [],
  activity30d = [],
  activity90d = [],
  totalFeedbacks = 0,
  processedFeedbacks = 0,
  satisfactionRate = '—',
}: AdminEvolutionChartProps) {
  const [period, setPeriod] = useState<'7j' | '30j' | '90j'>('7j');

  const chartData =
    period === '7j'
      ? activity7d
      : period === '30j'
      ? activity30d
      : activity90d;

  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: '24px',
        padding: '24px 28px',
        border: '1px solid #E8ECE6',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.02)',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Header du graphique : Titre + Badge En direct + Filtres & Calendrier */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2
              style={{
                fontSize: '1.15rem',
                fontWeight: 800,
                color: '#02302D',
                margin: 0,
              }}
            >
              Évolution des feedbacks
            </h2>
            <div
              style={{
                background: '#EBF5E9',
                color: '#3C7730',
                borderRadius: '9999px',
                padding: '3px 9px',
                fontSize: '0.74rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span className="live-dot" />
              <span>En direct</span>
            </div>
          </div>
          <p
            style={{
              color: '#64748B',
              fontSize: '0.84rem',
              marginTop: '4px',
              marginBottom: 0,
              fontWeight: 500,
            }}
          >
            Volume de feedbacks collectés et traités sur l'ensemble de la plateforme
          </p>
        </div>

        {/* Contrôles de droite : Filtres 7j / 30j / 90j + Bouton Calendrier */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Segmented Control */}
          <div
            style={{
              display: 'flex',
              background: '#F1F5F2',
              padding: '3px',
              borderRadius: '12px',
              gap: '2px',
            }}
          >
            {(['7j', '30j', '90j'] as const).map((p) => {
              const active = period === p;
              const label = p === '7j' ? '7 jours' : p === '30j' ? '30 jours' : '90 jours';
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{
                    background: active ? '#FFFFFF' : 'transparent',
                    color: active ? '#02302D' : '#64748B',
                    border: 'none',
                    borderRadius: '9px',
                    padding: '6px 14px',
                    fontSize: '0.8rem',
                    fontWeight: active ? 700 : 600,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Bouton Calendrier */}
          <button
            title="Sélecteur de date personnalisé"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: '#F8FAFB',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748B',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#EAF5EC';
              e.currentTarget.style.color = '#3C7730';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#F8FAFB';
              e.currentTarget.style.color = '#64748B';
            }}
          >
            <CalendarIcon size={16} />
          </button>
        </div>
      </div>

      {/* Légende du graphique avec données chiffrées en direct */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          marginBottom: '18px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '3px',
              background: '#02302D',
            }}
          />
          <span style={{ color: '#64748B', fontWeight: 600 }}>Feedbacks collectés :</span>
          <strong style={{ color: '#02302D', fontWeight: 800 }}>
            {totalFeedbacks.toLocaleString('fr-FR')}
          </strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '3px',
              background: '#75B72A',
            }}
          />
          <span style={{ color: '#64748B', fontWeight: 600 }}>Feedbacks traités :</span>
          <strong style={{ color: '#02302D', fontWeight: 800 }}>
            {processedFeedbacks.toLocaleString('fr-FR')}
          </strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '3px',
              background: '#38BDF8',
            }}
          />
          <span style={{ color: '#64748B', fontWeight: 600 }}>Satisfaction :</span>
          <strong style={{ color: '#02302D', fontWeight: 800 }}>{satisfactionRate}</strong>
        </div>
      </div>

      {/* Recharts Area Chart */}
      <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, height: 260, boxSizing: 'border-box' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradFeedbacks" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#02302D" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#02302D" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="gradProcessed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#75B72A" stopOpacity={0.38} />
                <stop offset="95%" stopColor="#75B72A" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF2EC" />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 600 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 600 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E8ECE6',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                fontSize: '0.84rem',
                fontWeight: 600,
                color: '#02302D',
              }}
            />
            <Area
              type="monotone"
              dataKey="feedbacks"
              name="Feedbacks collectés"
              stroke="#02302D"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#gradFeedbacks)"
            />
            <Area
              type="monotone"
              dataKey="users"
              name="Feedbacks traités"
              stroke="#75B72A"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#gradProcessed)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import React from 'react';
import type { InsightIADetail } from '../../types';
import { SparklesIcon, CheckCircleIcon, AlertTriangleIcon, LightbulbIcon } from '../common/Icons';

interface AiInsightsSummaryProps {
  insights: InsightIADetail[];
}

export default function AiInsightsSummary({ insights }: AiInsightsSummaryProps) {
  if (!insights || insights.length === 0) {
    return null;
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'point_fort':
        return <CheckCircleIcon size={16} color="#3C7730" />;
      case 'point_vigilance':
        return <AlertTriangleIcon size={16} color="#DC2626" />;
      case 'recommandation':
      default:
        return <LightbulbIcon size={16} color="#75B72A" />;
    }
  };

  const getBg = (type: string) => {
    switch (type) {
      case 'point_fort':
        return '#EBF6ED';
      case 'point_vigilance':
        return '#FEE2E2';
      case 'recommandation':
      default:
        return '#F5FAF5';
    }
  };

  const getBorder = (type: string) => {
    switch (type) {
      case 'point_fort':
        return '#D6E8D9';
      case 'point_vigilance':
        return '#FECACA';
      case 'recommandation':
      default:
        return '#E2EFE1';
    }
  };

  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: '24px',
        padding: '24px 28px',
        border: '1px solid #E8ECE6',
        boxShadow: '0 2px 12px rgba(20, 60, 40, 0.03)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
        <SparklesIcon size={20} color="#75B72A" />
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#02302D' }}>
            Synthèse & Recommandations IA
          </div>
          <div style={{ fontSize: '0.76rem', color: '#64748B' }}>
            Faits marquants et actions préconisées par l'intelligence IKAN
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
        {insights.map((item) => (
          <div
            key={item.id}
            style={{
              background: getBg(item.type),
              border: `1px solid ${getBorder(item.type)}`,
              borderRadius: '16px',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                {getIcon(item.type)}
                <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#02302D' }}>
                  {item.titre}
                </span>
              </div>
              <p
                style={{
                  fontSize: '0.78rem',
                  color: '#475569',
                  lineHeight: 1.45,
                  margin: 0,
                }}
              >
                {item.description}
              </p>
            </div>

            {item.agence_nom && (
              <div style={{ fontSize: '0.70rem', fontWeight: 700, color: '#3C7730' }}>
                📍 {item.agence_nom}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

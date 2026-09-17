import React from 'react';
import type { ThemeStatsDetail } from '../../types';

interface ThemesBarListProps {
  themes: ThemeStatsDetail[];
  maxItems?: number;
}

const SENTIMENT_DOT_COLOR: Record<string, string> = {
  positif: '#3C7730',
  neutre: '#F59E0B',
  negatif: '#DC2626',
};

export default function ThemesBarList({ themes, maxItems = 6 }: ThemesBarListProps) {
  const displayThemes = themes.slice(0, maxItems);

  if (!displayThemes || displayThemes.length === 0) {
    return (
      <div
        style={{
          padding: '28px',
          textAlign: 'center',
          color: '#94A3B8',
          fontSize: '0.84rem',
          background: '#FAFCFA',
          borderRadius: '16px',
          border: '1px dashed #D6E8D9',
        }}
      >
        Aucun thème prédominant détecté pour cette période.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
      {displayThemes.map((item) => {
        const dotColor = SENTIMENT_DOT_COLOR[item.sentiment_predominant.toLowerCase()] || '#94A3B8';
        return (
          <div key={item.theme} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.82rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                  title={`Sentiment prédominant: ${item.sentiment_predominant}`}
                />
                <span style={{ fontWeight: 600, color: '#0F172A' }}>{item.label}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#64748B', fontSize: '0.74rem' }}>{item.count} avis</span>
                <span style={{ fontWeight: 800, color: '#02302D', minWidth: '40px', textAlign: 'right' }}>
                  {item.pourcentage}%
                </span>
              </div>
            </div>

            {/* Progress Bar Container */}
            <div
              style={{
                width: '100%',
                height: '7px',
                background: '#F1F5F9',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, item.pourcentage))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #3C7730 0%, #75B72A 100%)',
                  borderRadius: '9999px',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

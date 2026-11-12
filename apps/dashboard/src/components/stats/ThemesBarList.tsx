import React from 'react';
import { Link } from 'react-router-dom';
import type { ThemeStatsDetail } from '../../types';
import type { SentimentType } from '../../types';
import { SENTIMENT_LABELS } from '../../utils/vocabulaire';
import { themeLabel } from '../../utils/themeLabels';
import { PartNegatifsTexte } from '../../utils/partNegatifs';
import { formaterPourcentage } from '../../utils/formatNombre';

interface ThemesBarListProps {
  themes: ThemeStatsDetail[];
  maxItems?: number;
  /** Lien vers les avis d'un thème (liste « Avis du réseau » filtrée) : le nom du thème devient cliquable. */
  lienTheme?: (theme: ThemeStatsDetail) => string;
  showSentiment?: boolean;
}

const SENTIMENT_DOT_COLOR: Record<string, string> = {
  positif: 'var(--color-marque)',
  neutre: 'var(--color-neutre-texte)',
  negatif: 'var(--color-critique-texte)',
};

export default function ThemesBarList({ themes, maxItems = 6, lienTheme, showSentiment = true }: ThemesBarListProps) {
  const displayThemes = [...themes].sort((a, b) => b.count - a.count).slice(0, maxItems);

  if (!displayThemes || displayThemes.length === 0) {
    return (
      <div
        style={{
          padding: '28px',
          textAlign: 'center',
          color: 'var(--color-text-2)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-bg)',
          borderRadius: '16px',
          border: '1px dashed var(--color-trait)',
        }}
      >
        Aucun thème prédominant détecté pour cette période.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
      {displayThemes.map((item) => {
        const dotColor = SENTIMENT_DOT_COLOR[item.sentiment_predominant.toLowerCase()] || 'var(--color-text-2)';
        return (
          <div key={item.theme} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 'var(--text-sm)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {showSentiment && <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                  title={`Ton dominant : ${SENTIMENT_LABELS[item.sentiment_predominant as SentimentType] ?? item.sentiment_predominant}`}
                />}
                {(() => {
                  const libelle = /^[a-z0-9_]+$/.test(item.label ?? '') || !item.label ? themeLabel(item.label || item.theme) : item.label;
                  return lienTheme ? (
                    <Link to={lienTheme(item)} style={{ minWidth: 0, fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', overflowWrap: 'anywhere', textDecoration: 'underline', textUnderlineOffset: 3 }} aria-label={`Voir les avis du thème ${libelle}`}>
                      {libelle}
                    </Link>
                  ) : (
                    <span style={{ minWidth: 0, fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', overflowWrap: 'anywhere' }}>{libelle}</span>
                  );
                })()}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span className="t-2 t-xs">{item.count} avis</span>
                <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', minWidth: '40px', textAlign: 'right' }}>
                  {formaterPourcentage(item.pourcentage)}
                </span>
              </div>
            </div>

            {item.part_negatifs && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', paddingLeft: '15px' }}>
                <PartNegatifsTexte pn={item.part_negatifs} />
              </div>
            )}

            {/* Progress Bar Container */}
            <div
              style={{
                width: '100%',
                height: '7px',
                background: 'var(--color-neutre-fond)',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, item.pourcentage))}%`,
                  height: '100%',
                  background: 'var(--dataviz-info)',
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

import React from 'react';
import type { SentimentType } from '../../types';

const OPTIONS: { value: SentimentType | null; label: string }[] = [
  { value: null, label: 'Tous' },
  { value: 'positif', label: 'Positif' },
  { value: 'neutre', label: 'Neutre' },
  { value: 'negatif', label: 'Négatif' },
];

interface VeilleSentimentFilterProps {
  value: SentimentType | null;
  onChange: (value: SentimentType | null) => void;
}

/** Filtre sentiment sous forme de boutons — état actif visible (fond plein + aria-pressed, pas la couleur seule). */
export default function VeilleSentimentFilter({ value, onChange }: VeilleSentimentFilterProps) {
  return (
    <div
      role="group"
      aria-label="Filtrer les mentions par ton"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
      }}
    >
      {OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt.value)}
            className={isActive ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '6px 14px', fontSize: '0.8rem' }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

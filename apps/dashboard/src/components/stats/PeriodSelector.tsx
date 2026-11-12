import React from 'react';

export interface PeriodOption {
  label: string;
  jours: number;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { label: "Aujourd'hui", jours: 1 },
  { label: '7 jours', jours: 7 },
  { label: '14 jours', jours: 14 },
  { label: '30 jours', jours: 30 },
  { label: '90 jours', jours: 90 },
  { label: 'Cette année', jours: 365 },
];

interface PeriodSelectorProps {
  value: number;
  onChange: (jours: number) => void;
  options?: PeriodOption[];
}

export default function PeriodSelector({
  value,
  onChange,
  options = PERIOD_OPTIONS,
}: PeriodSelectorProps) {
  return (
    <div
        role="group"
        aria-label="Période d’analyse"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'var(--color-surface)',
        padding: '3px',
        borderRadius: '12px',
        border: '1px solid var(--color-trait)',
        gap: '2px',
        flexWrap: 'wrap',
      }}
    >
      {options.map((opt) => {
        const isSelected = value === opt.jours;
        return (
          <button
            key={opt.jours}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(opt.jours)}
            style={{
              padding: '6px 12px',
              fontSize: 'var(--text-xs)',
              fontWeight: isSelected ? 'var(--weight-semibold)' : 'var(--weight-normal)',
              color: isSelected ? 'var(--color-text-inverse)' : 'var(--color-text-2)',
              background: isSelected ? 'var(--color-encre)' : 'transparent',
              border: 'none',
              borderRadius: '9px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.color = 'var(--color-encre)';
                e.currentTarget.style.background = 'var(--color-neutre-fond)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.color = 'var(--color-text-2)';
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

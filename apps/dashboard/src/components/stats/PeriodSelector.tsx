import React from 'react';
import { PERIODES, type Periode } from '../../utils/periodes';

export type PeriodOption = Periode;

/** La liste unique du dashboard (utils/periodes.ts) : 7 jours, 30 jours, 90 jours, 12 mois. */
export const PERIOD_OPTIONS: readonly PeriodOption[] = PERIODES;

interface PeriodSelectorProps {
  value: number;
  onChange: (jours: number) => void;
  options?: readonly PeriodOption[];
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

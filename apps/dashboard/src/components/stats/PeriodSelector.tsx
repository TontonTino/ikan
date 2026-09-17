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
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: '#FFFFFF',
        padding: '3px',
        borderRadius: '12px',
        border: '1px solid #E2E8F0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
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
            onClick={() => onChange(opt.jours)}
            style={{
              padding: '6px 12px',
              fontSize: '0.80rem',
              fontWeight: isSelected ? 700 : 500,
              color: isSelected ? '#FFFFFF' : '#64748B',
              background: isSelected ? '#02302D' : 'transparent',
              border: 'none',
              borderRadius: '9px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.color = '#02302D';
                e.currentTarget.style.background = '#F1F5F9';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.color = '#64748B';
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

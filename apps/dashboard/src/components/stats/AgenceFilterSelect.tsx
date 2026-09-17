import React from 'react';
import { StoreIcon, ChevronDownIcon } from '../common/Icons';

export interface AgenceOption {
  id: string;
  nom: string;
  ville?: string | null;
}

interface AgenceFilterSelectProps {
  agences: AgenceOption[];
  selectedId: string | null;
  onChange: (agenceId: string | null) => void;
}

export default function AgenceFilterSelect({
  agences,
  selectedId,
  onChange,
}: AgenceFilterSelectProps) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '12px',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          color: '#3C7730',
        }}
      >
        <StoreIcon size={16} />
      </div>

      <select
        value={selectedId || ''}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '12px',
          padding: '8px 34px 8px 36px',
          fontSize: '0.82rem',
          fontWeight: 600,
          color: '#0F172A',
          cursor: 'pointer',
          fontFamily: 'inherit',
          outline: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          transition: 'border-color 0.15s ease',
          minWidth: '200px',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#3C7730')}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#E2E8F0')}
      >
        <option value="">Toutes les agences du réseau</option>
        {agences.map((ag) => (
          <option key={ag.id} value={ag.id}>
            {ag.nom} {ag.ville ? `(${ag.ville})` : ''}
          </option>
        ))}
      </select>

      <div
        style={{
          position: 'absolute',
          right: '12px',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          color: '#64748B',
        }}
      >
        <ChevronDownIcon size={14} />
      </div>
    </div>
  );
}

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
  /** Nom accessible du sélecteur (défaut : « Filtrer par agence »). */
  label?: string;
}

export default function AgenceFilterSelect({
  agences,
  selectedId,
  onChange,
  label = 'Filtrer par agence',
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
          color: 'var(--color-bon-texte)',
        }}
      >
        <StoreIcon size={16} />
      </div>

      <select
        aria-label={label}
        value={selectedId || ''}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-trait)',
          borderRadius: '12px',
          padding: '8px 34px 8px 36px',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--color-encre)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          outline: 'none',
          transition: 'border-color 0.15s ease',
          minWidth: '200px',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-trait)')}
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
          color: 'var(--color-text-2)',
        }}
      >
        <ChevronDownIcon size={14} />
      </div>
    </div>
  );
}

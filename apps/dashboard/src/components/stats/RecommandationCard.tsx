import React from 'react';
import type { Recommandation } from '../../types';
import { CheckIcon } from '../common/Icons';

export const PRIORITE_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  critical: { bg: 'var(--color-critique-fond)', border: 'var(--color-critique-fond)', text: 'var(--color-critique-texte)', label: 'CRITIQUE' },
  high: { bg: 'var(--color-surveiller-fond)', border: 'var(--color-surveiller-fond)', text: 'var(--color-surveiller-texte)', label: 'ÉLEVÉE' },
  medium: { bg: 'var(--color-neutre-fond)', border: 'var(--color-neutre-fond)', text: 'var(--color-neutre-texte)', label: 'MOYENNE' },
  low: { bg: 'var(--color-bon-fond)', border: 'var(--color-bon-fond)', text: 'var(--color-bon-texte)', label: 'FAIBLE' },
};

interface RecommandationCardProps {
  recommandation: Recommandation;
  /** Nom de l'agence concernée — affiché uniquement dans une vue multi-agences (CX Manager). */
  agenceNom?: string;
  onMarquerTraitee?: (id: string) => void;
}

export default function RecommandationCard({ recommandation: r, agenceNom, onMarquerTraitee }: RecommandationCardProps) {
  const pStyle = PRIORITE_STYLE[r.priorite] || {
    bg: 'var(--color-bg)',
    border: 'var(--color-trait)',
    text: 'var(--color-text-2)',
    label: r.priorite,
  };

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-trait)',
        borderLeft: `5px solid ${pStyle.border}`,
        borderRadius: '16px',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: '220px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              background: pStyle.bg,
              color: pStyle.text,
              border: `1px solid ${pStyle.border}`,
              padding: '2px 8px',
              borderRadius: '9999px',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
            }}
          >
            PRIORITÉ {pStyle.label}
          </span>
          {agenceNom && (
            <span
              style={{
                background: 'var(--color-neutre-fond)',
                color: 'var(--color-text-2)',
                padding: '2px 8px',
                borderRadius: '9999px',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
              }}
            >
              📍 {agenceNom}
            </span>
          )}
          <span className="t-xs t-2 t-semi">
            {new Date(r.date_generation).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
        </div>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-encre)', lineHeight: 1.5, fontWeight: 'var(--weight-semibold)' }}>
          {r.contenu}
        </span>
      </div>

      {onMarquerTraitee && (
        <button
          onClick={() => onMarquerTraitee(r.id)}
          className="btn-primary"
          style={{ fontSize: 'var(--text-xs)', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <CheckIcon size={14} />
          <span>Marquer comme traitée</span>
        </button>
      )}
    </div>
  );
}

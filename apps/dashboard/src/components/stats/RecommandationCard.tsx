import React from 'react';
import type { Recommandation } from '../../types';
import { CheckIcon } from '../common/Icons';

export const PRIORITE_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  critical: { bg: '#FEE2E2', border: '#DC2626', text: '#991B1B', label: 'CRITIQUE' },
  high: { bg: '#FEF3C7', border: '#D97706', text: '#92400E', label: 'ÉLEVÉE' },
  medium: { bg: '#E0F2FE', border: '#0284C7', text: '#075985', label: 'MOYENNE' },
  low: { bg: '#EBF5E9', border: '#3C7730', text: '#166534', label: 'FAIBLE' },
};

interface RecommandationCardProps {
  recommandation: Recommandation;
  /** Nom de l'agence concernée — affiché uniquement dans une vue multi-agences (CX Manager). */
  agenceNom?: string;
  onMarquerTraitee?: (id: string) => void;
}

export default function RecommandationCard({ recommandation: r, agenceNom, onMarquerTraitee }: RecommandationCardProps) {
  const pStyle = PRIORITE_STYLE[r.priorite] || {
    bg: '#F8FAFB',
    border: '#E2E8F0',
    text: '#475569',
    label: r.priorite,
  };

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E8ECE6',
        borderLeft: `5px solid ${pStyle.border}`,
        borderRadius: '16px',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
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
              fontSize: '0.7rem',
              fontWeight: 800,
            }}
          >
            PRIORITÉ {pStyle.label}
          </span>
          {agenceNom && (
            <span
              style={{
                background: '#F1F5F9',
                color: '#475569',
                padding: '2px 8px',
                borderRadius: '9999px',
                fontSize: '0.7rem',
                fontWeight: 700,
              }}
            >
              📍 {agenceNom}
            </span>
          )}
          <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600 }}>
            {new Date(r.date_generation).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
        </div>
        <span style={{ fontSize: '0.9rem', color: '#1E293B', lineHeight: 1.5, fontWeight: 600 }}>
          {r.contenu}
        </span>
      </div>

      {onMarquerTraitee && (
        <button
          onClick={() => onMarquerTraitee(r.id)}
          className="btn-primary"
          style={{ fontSize: '0.8rem', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <CheckIcon size={14} />
          <span>Marquer comme traité</span>
        </button>
      )}
    </div>
  );
}

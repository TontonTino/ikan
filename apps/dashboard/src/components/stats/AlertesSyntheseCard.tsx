import React from 'react';
import type { AlerteSyntheseDetail } from '../../types';
import { AlertTriangleIcon, ArrowDownRightIcon, ArrowUpRightIcon, StoreIcon } from '../common/Icons';

interface AlertesSyntheseCardProps {
  alertes: AlerteSyntheseDetail;
  onSelectAgence?: (agenceId: string) => void;
}

export default function AlertesSyntheseCard({
  alertes,
  onSelectAgence,
}: AlertesSyntheseCardProps) {
  const hasAlerts = alertes.total_critiques > 0;

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: hasAlerts ? '1px solid var(--color-critique-fond)' : '1px solid var(--color-trait)',
        borderRadius: '20px',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: hasAlerts ? 'var(--color-critique-fond)' : 'var(--color-bon-fond)',
              color: hasAlerts ? 'var(--color-critique-texte)' : 'var(--color-bon-texte)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangleIcon size={18} />
          </div>
          <div>
            <div className="t-sm t-semi t-encre">
              Avis d’urgence critique
            </div>
            <div className="t-xs t-2">
              Urgence calculée automatiquement à partir de la note, du ton et de mots-clés
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              background: hasAlerts ? 'var(--color-critique-fond)' : 'var(--color-bon-fond)',
              color: hasAlerts ? 'var(--color-critique-texte)' : 'var(--color-bon-texte)',
              padding: '4px 12px',
              borderRadius: '9999px',
              fontWeight: 'var(--weight-semibold)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {alertes.total_critiques} avis critique{alertes.total_critiques > 1 ? 's' : ''}
          </span>
          {alertes.evolution_pct && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                color: alertes.evolution_positive ? 'var(--color-bon-texte)' : 'var(--color-critique-texte)',
              }}
            >
              {alertes.evolution_positive ? (
                <ArrowDownRightIcon size={12} color="var(--color-bon-texte)" />
              ) : (
                <ArrowUpRightIcon size={12} color="var(--color-critique-texte)" />
              )}
              {alertes.evolution_pct} vs période précédente
            </span>
          )}
        </div>
      </div>

      {/* Body: Agences Impactées */}
      {hasAlerts && alertes.agences_impactees.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="t-xs t-semi t-2 t-majuscules">
            Agences concernées ({alertes.agences_impactees.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {alertes.agences_impactees.map((ag) => (
              <div
                key={ag.agence_id}
                onClick={() => onSelectAgence && onSelectAgence(ag.agence_id)}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-critique-fond)',
                  borderRadius: '10px',
                  padding: '6px 12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--color-encre)',
                  cursor: onSelectAgence ? 'pointer' : 'default',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (onSelectAgence) e.currentTarget.style.background = 'var(--color-critique-fond)';
                }}
                onMouseLeave={(e) => {
                  if (onSelectAgence) e.currentTarget.style.background = 'var(--color-surface)';
                }}
              >
                <StoreIcon size={14} color="var(--color-critique-texte)" />
                <span>{ag.agence_nom}</span>
                <span
                  style={{
                    background: 'var(--color-critique-texte)',
                    color: 'var(--color-text-inverse)',
                    borderRadius: '9999px',
                    padding: '1px 6px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-semibold)',
                  }}
                >
                  {ag.alertes_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="t-xs t-bon t-semi">
          ✅ Aucun avis critique sur cette période.
        </div>
      )}
    </div>
  );
}

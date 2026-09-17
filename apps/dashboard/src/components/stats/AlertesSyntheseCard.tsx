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
        background: hasAlerts ? '#FFFBFB' : '#FAFCFA',
        border: hasAlerts ? '1px solid #FECACA' : '1px solid #E8ECE6',
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
              background: hasAlerts ? '#FEE2E2' : '#EBF6ED',
              color: hasAlerts ? '#DC2626' : '#3C7730',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangleIcon size={18} />
          </div>
          <div>
            <div style={{ fontSize: '0.90rem', fontWeight: 800, color: '#02302D' }}>
              Synthèse des Alertes Critiques
            </div>
            <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
              Détection automatique par le moteur de criticité IA
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              background: hasAlerts ? '#FEE2E2' : '#EBF6ED',
              color: hasAlerts ? '#DC2626' : '#3C7730',
              padding: '4px 12px',
              borderRadius: '9999px',
              fontWeight: 800,
              fontSize: '0.84rem',
            }}
          >
            {alertes.total_critiques} critique{alertes.total_critiques > 1 ? 's' : ''}
          </span>
          {alertes.evolution_pct && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '0.74rem',
                fontWeight: 700,
                color: alertes.evolution_positive ? '#3C7730' : '#DC2626',
              }}
            >
              {alertes.evolution_positive ? (
                <ArrowDownRightIcon size={12} color="#3C7730" />
              ) : (
                <ArrowUpRightIcon size={12} color="#DC2626" />
              )}
              {alertes.evolution_pct}
            </span>
          )}
        </div>
      </div>

      {/* Body: Agences Impactées */}
      {hasAlerts && alertes.agences_impactees.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
            Agences concernées ({alertes.agences_impactees.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {alertes.agences_impactees.map((ag) => (
              <div
                key={ag.agence_id}
                onClick={() => onSelectAgence && onSelectAgence(ag.agence_id)}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #FECACA',
                  borderRadius: '10px',
                  padding: '6px 12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#0F172A',
                  cursor: onSelectAgence ? 'pointer' : 'default',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (onSelectAgence) e.currentTarget.style.background = '#FEE2E2';
                }}
                onMouseLeave={(e) => {
                  if (onSelectAgence) e.currentTarget.style.background = '#FFFFFF';
                }}
              >
                <StoreIcon size={14} color="#DC2626" />
                <span>{ag.agence_nom}</span>
                <span
                  style={{
                    background: '#DC2626',
                    color: '#FFFFFF',
                    borderRadius: '9999px',
                    padding: '1px 6px',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                  }}
                >
                  {ag.alertes_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '0.80rem', color: '#3C7730', fontWeight: 600 }}>
          ✅ Aucune alerte critique sur cette période. Toutes les agences respectent leurs seuils.
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { RefreshCwIcon, AlertTriangleIcon, BarChartIcon } from '../common/Icons';

export function StatsLoadingState({ message = 'Calcul des statistiques en cours...' }: { message?: string }) {
  return (
    <div
      style={{
        padding: '60px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        background: 'var(--color-surface)',
        borderRadius: '24px',
        border: '1px solid var(--color-trait)',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          border: '3px solid var(--color-neutre-fond)',
          borderTopColor: 'var(--color-marque)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <div className="t-sm t-2 t-semi">{message}</div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export function StatsErrorState({
  message = 'Une erreur est survenue lors de la récupération des statistiques.',
  onRetry,
  title = 'Impossible de charger ces informations',
}: {
  message?: string;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: '48px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        background: 'var(--color-surface)',
        borderRadius: '24px',
        border: '1px solid var(--color-critique-fond)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '14px',
          background: 'var(--color-critique-fond)',
          color: 'var(--color-critique-texte)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AlertTriangleIcon size={24} />
      </div>
      <div className="t-base t-semi t-encre">
        {title}
      </div>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', maxWidth: '420px', margin: 0 }}>
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-primary"
          style={{ marginTop: '8px' }}
        >
          <RefreshCwIcon size={14} />
          Réessayer
        </button>
      )}
    </div>
  );
}

export function StatsEmptyState({
  title = 'Aucune donnée disponible',
  description = 'Aucun avis client ne correspond aux filtres sélectionnés.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      style={{
        padding: '60px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        background: 'var(--color-surface)',
        borderRadius: '24px',
        border: '1px dashed var(--color-trait)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '14px',
          background: 'var(--color-bon-fond)',
          color: 'var(--color-bon-texte)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <BarChartIcon size={22} color="var(--color-bon-texte)" />
      </div>
      <div className="t-base t-semi t-encre">{title}</div>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', maxWidth: '420px', margin: 0 }}>
        {description}
      </p>
    </div>
  );
}

export function StatsSectionCard({
  title,
  subtitle,
  children,
  action,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: compact ? '18px' : '24px',
        padding: compact ? '18px 20px' : '24px 28px',
        border: '1px solid var(--color-trait)',
        width: '100%',
        boxSizing: 'border-box',
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: compact ? '14px' : '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-encre)',
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-2)',
                margin: '3px 0 0',
                fontWeight: 'var(--weight-normal)',
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>

      {children}
    </div>
  );
}

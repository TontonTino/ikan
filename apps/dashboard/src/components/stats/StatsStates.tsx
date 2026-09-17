import React from 'react';
import { RefreshCwIcon, AlertTriangleIcon, SparklesIcon } from '../common/Icons';

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
        background: '#FFFFFF',
        borderRadius: '24px',
        border: '1px solid #E8ECE6',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          border: '3px solid #EBF6ED',
          borderTopColor: '#3C7730',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <div style={{ fontSize: '0.90rem', color: '#64748B', fontWeight: 600 }}>{message}</div>
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
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        padding: '48px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        background: '#FFFBFB',
        borderRadius: '24px',
        border: '1px solid #FECACA',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '14px',
          background: '#FEE2E2',
          color: '#DC2626',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AlertTriangleIcon size={24} />
      </div>
      <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#0F172A' }}>
        Impossible de charger les analyses
      </div>
      <p style={{ fontSize: '0.84rem', color: '#64748B', maxWidth: '420px', margin: 0 }}>
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: '8px',
            background: '#02302D',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '12px',
            padding: '10px 20px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'inherit',
          }}
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
  description = 'Aucun feedback n’a été enregistré pour les filtres sélectionnés.',
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
        background: '#FFFFFF',
        borderRadius: '24px',
        border: '1px dashed #D6E8D9',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '14px',
          background: '#EBF6ED',
          color: '#3C7730',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SparklesIcon size={22} color="#3C7730" />
      </div>
      <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#02302D' }}>{title}</div>
      <p style={{ fontSize: '0.84rem', color: '#64748B', maxWidth: '420px', margin: 0 }}>
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: '24px',
        padding: '24px 28px',
        boxShadow: '0 2px 12px rgba(20, 60, 40, 0.03)',
        border: '1px solid #E8ECE6',
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
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: '1.05rem',
              fontWeight: 800,
              color: '#02302D',
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <p
              style={{
                fontSize: '0.78rem',
                color: '#64748B',
                margin: '3px 0 0',
                fontWeight: 500,
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

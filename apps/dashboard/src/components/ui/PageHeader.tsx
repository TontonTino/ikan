import React from 'react';
import { SparklesIcon, ClockIcon, DownloadIcon, LightningIcon } from '../common/Icons';

export interface PageHeaderProps {
  title?: string;
  greetingUser?: string;
  subtitle: string;
  dateText?: string;
  onRefresh?: () => void;
  onExport?: () => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  children?: React.ReactNode;
}

export default function PageHeader({
  title,
  greetingUser,
  subtitle,
  dateText,
  onRefresh,
  onExport,
  primaryAction,
  children,
}: PageHeaderProps) {
  // Format standard date en français si non fournie (ex: SAMEDI, 22 AOÛT 2026)
  const defaultDate = React.useMemo(() => {
    try {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      };
      return now.toLocaleDateString('fr-FR', options).toUpperCase();
    } catch {
      return 'VENDREDI, 22 AOÛT 2026';
    }
  }, []);

  const displayDate = dateText || defaultDate;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #F4FAF5 0%, #EBF6ED 100%)',
        borderRadius: '24px',
        border: '1px solid #D6E8D9',
        boxShadow: '0 4px 20px rgba(2, 48, 45, 0.04)',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '20px',
        marginBottom: '24px',
        flexWrap: 'wrap',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Left side: Date + Title + Subtitle */}
      <div>
        <div
          style={{
            fontSize: '0.74rem',
            fontWeight: 800,
            color: '#6B8E6A',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: '4px',
          }}
        >
          {displayDate}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h1
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              color: '#02302D',
              margin: 0,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            {greetingUser ? `Bonjour ${greetingUser}` : title}
          </h1>
          <SparklesIcon size={24} color="#75B72A" />
        </div>

        <p
          style={{
            color: '#64748B',
            fontSize: '0.92rem',
            marginTop: '6px',
            marginBottom: 0,
            fontWeight: 500,
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Right side: Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {/* Status Pill : Mis à jour à l'instant */}
        <div
          onClick={onRefresh}
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '9999px',
            padding: '8px 14px',
            fontSize: '0.82rem',
            color: '#64748B',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            cursor: onRefresh ? 'pointer' : 'default',
          }}
        >
          <ClockIcon size={14} color="#64748B" />
          <span>
            Mis à jour <strong style={{ color: '#02302D' }}>à l'instant</strong>
          </span>
        </div>

        {/* Bouton Exporter */}
        {onExport && (
          <button
            onClick={onExport}
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '9px 16px',
              fontSize: '0.84rem',
              color: '#1E293B',
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFB')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
          >
            <DownloadIcon size={15} color="#1E293B" />
            Exporter
          </button>
        )}

        {/* Bouton d'action principale */}
        {primaryAction && (
          <button
            onClick={primaryAction.onClick}
            style={{
              background: '#3C7730',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '12px',
              padding: '10px 18px',
              fontSize: '0.86rem',
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 2px 8px rgba(60, 119, 48, 0.25)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#02302D';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#3C7730';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {primaryAction.icon || <LightningIcon size={15} color="#FFFFFF" />}
            {primaryAction.label}
          </button>
        )}

        {children}
      </div>
    </div>
  );
}

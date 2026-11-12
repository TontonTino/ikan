import React from 'react';
import { RefreshIcon, DownloadIcon, LightningIcon, CalendarIcon } from '../common/Icons';

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
  /** Affiche la date du jour en toutes lettres (ex. "Lundi 28 septembre 2026") à côté
      des actions (sélecteur de période, etc.), en lecture seule — aucune interaction de
      calendrier. Optionnel pour ne pas changer l'affichage des pages qui ne le passent pas. */
  showDateBesideActions?: boolean;
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
  showDateBesideActions = false,
  children,
}: PageHeaderProps) {
  // Date du jour en français, casse phrase (ex: "Lundi 28 septembre 2026") — l'eyebrow
  // ci-dessous l'affiche en majuscules via CSS (textTransform), pour pouvoir réutiliser
  // la même chaîne telle quelle à côté des actions (showDateBesideActions).
  const todayLabel = React.useMemo(() => {
    try {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      };
      const str = now.toLocaleDateString('fr-FR', options);
      return str.charAt(0).toUpperCase() + str.slice(1);
    } catch {
      return 'Vendredi 22 août 2026';
    }
  }, []);

  const displayDate = dateText || todayLabel;

  return (
    <div
      className="page-header-shell"
      style={{
        background: 'linear-gradient(135deg, var(--color-bg) 0%, var(--color-bon-fond) 100%)',
        borderRadius: '24px',
        border: '1px solid var(--color-trait)',
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
        {/* Avec greetingUser, la date figure déjà dans la pastille à côté des actions
            (showDateBesideActions) : cet eyebrow ferait doublon, donc masqué dans ce cas. */}
        {!greetingUser && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-2)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}
          >
            {displayDate}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h1
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-encre)',
              margin: 0,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            {greetingUser ? `Bonjour, ${greetingUser}` : title}
          </h1>
        </div>

        <p
          style={{
            color: 'var(--color-text-2)',
            fontSize: 'var(--text-base)',
            marginTop: '6px',
            marginBottom: 0,
            fontWeight: 'var(--weight-normal)',
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Right side: Action buttons */}
      <div className="page-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {/* Date du jour en toutes lettres, lecture seule — aucune interaction de calendrier. */}
        {showDateBesideActions && (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-trait)',
              borderRadius: '9999px',
              padding: '8px 14px',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-encre)',
              fontWeight: 'var(--weight-semibold)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <CalendarIcon size={14} color="var(--color-text-2)" />
            <span>{displayDate}</span>
          </div>
        )}

        {onRefresh && (
          <button
            type="button"
            className="page-refresh-button"
            onClick={onRefresh}
            aria-label="Actualiser les données"
            title="Actualiser les données"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-trait)',
              borderRadius: '9999px',
              padding: '8px 14px',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-encre)',
              fontWeight: 'var(--weight-semibold)',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
          >
            <RefreshIcon size={15} color="var(--color-bon-texte)" />
            <span>Actualiser</span>
          </button>
        )}

        {/* Bouton Exporter */}
        {onExport && (
          <button
            onClick={onExport}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-trait)',
              borderRadius: '12px',
              padding: '9px 16px',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-encre)',
              fontWeight: 'var(--weight-semibold)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
          >
            <DownloadIcon size={15} color="var(--color-encre)" />
            Exporter
          </button>
        )}

        {/* Bouton d'action principale */}
        {primaryAction && (
          <button
            onClick={primaryAction.onClick}
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
              border: 'none',
              borderRadius: '12px',
              padding: '10px 18px',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-accent-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--color-accent)';
            }}
          >
            {primaryAction.icon || <LightningIcon size={15} color="var(--color-text-inverse)" />}
            {primaryAction.label}
          </button>
        )}

        {children}
      </div>

      <style>{`
        @media (max-width: 640px) {
          .page-header-shell {
            flex-direction: column !important;
            align-items: flex-start !important;
            padding: 18px !important;
          }
          .page-header-actions {
            width: 100%;
          }
          .page-header-actions > * {
            flex: 1 1 auto;
          }
          .page-refresh-button {
            justify-content: center;
          }
          .page-refresh-button:focus-visible {
            outline: 2px solid var(--color-accent);
            outline-offset: 2px;
          }
        }
        .page-refresh-button:hover {
          background: var(--color-bg) !important;
          border-color: var(--color-border) !important;
        }
        .page-refresh-button:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

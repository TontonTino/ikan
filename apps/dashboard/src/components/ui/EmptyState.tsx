import React from 'react';
import Button from './Button';

// ── Illustrations SVG inline par thème ──────────────────────────
function IllustrationNoData() {
  return (
    <svg
      width="120" height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="10" y="20" width="100" height="65" rx="12"
        fill="var(--color-active-item)" />
      <rect x="22" y="32" width="60" height="8" rx="4"
        fill="var(--color-border)" />
      <rect x="22" y="46" width="40" height="6" rx="3"
        fill="var(--color-border)" opacity="0.6" />
      <rect x="22" y="58" width="50" height="6" rx="3"
        fill="var(--color-border)" opacity="0.4" />
      <circle cx="90" cy="68" r="18"
        fill="var(--color-bg)" stroke="var(--color-border)" strokeWidth="1.5" />
      <path d="M84 68 h12 M90 62 v12"
        stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function IllustrationNoAlert() {
  return (
    <svg
      width="120" height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="60" cy="50" r="38"
        fill="var(--color-success-bg)" />
      <path
        d="M44 52 L55 63 L77 38"
        stroke="var(--color-success)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IllustrationNoFeedback() {
  return (
    <svg
      width="120" height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="14" y="18" width="92" height="58" rx="14"
        fill="var(--color-active-item)" />
      <path
        d="M14 54 C14 62 30 76 60 76 C90 76 106 62 106 54"
        fill="var(--color-bg)"
      />
      <rect x="30" y="32" width="60" height="7" rx="3.5"
        fill="var(--color-border)" />
      <rect x="38" y="44" width="44" height="5" rx="2.5"
        fill="var(--color-border)" opacity="0.55" />
      {/* Bulles de dialogue */}
      <circle cx="55" cy="70" r="4" fill="var(--color-active-item)" />
      <circle cx="66" cy="74" r="3" fill="var(--color-active-item)" />
      <circle cx="75" cy="76" r="2" fill="var(--color-active-item)" />
    </svg>
  );
}

function IllustrationDefault() {
  return (
    <svg
      width="120" height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="20" y="15" width="80" height="70" rx="14"
        fill="var(--color-active-item)" />
      <circle cx="60" cy="45" r="16"
        fill="var(--color-bg)" stroke="var(--color-border)" strokeWidth="1.5" />
      <path d="M60 37 v9 M60 49 v2"
        stroke="var(--color-text-muted)" strokeWidth="2.5"
        strokeLinecap="round" />
    </svg>
  );
}

const ILLUSTRATIONS: Record<string, React.ReactNode> = {
  'no-data': <IllustrationNoData />,
  'no-alert': <IllustrationNoAlert />,
  'no-feedback': <IllustrationNoFeedback />,
};

// ── Props ────────────────────────────────────────────────────────
interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  /** Ce qui manque, formulé simplement (« Aucun feedback critique sur cette période »). */
  title: string;
  /** Pourquoi il n'y a rien, et ce que l'utilisateur peut faire. */
  message?: string;
  /**
   * Clé de l'illustration :
   *  'no-data' | 'no-alert' | 'no-feedback' | ReactNode personnalisé | null (aucune)
   */
  illustration?: string | React.ReactNode;
  /** Action principale optionnelle. */
  action?: EmptyStateAction;
  /** Action secondaire optionnelle (ex. « Changer la période »). */
  secondaryAction?: EmptyStateAction;
  /** Centrage vertical si dans un plein écran */
  fullHeight?: boolean;
  /** Version réduite pour une carte ou un graphique (sans illustration par défaut). */
  compact?: boolean;
}

// ── Composant ────────────────────────────────────────────────────
export default function EmptyState({
  title,
  message,
  illustration,
  action,
  secondaryAction,
  fullHeight = false,
  compact = false,
}: EmptyStateProps) {
  const key = illustration === undefined ? (compact ? null : 'no-data') : illustration;
  const illu =
    key === null
      ? null
      : typeof key === 'string'
        ? ILLUSTRATIONS[key] ?? <IllustrationDefault />
        : key;

  const classes = ['ui-empty', compact && 'ui-empty--compact', fullHeight && 'ui-empty--full'].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {illu && <div className="ui-empty__illu" aria-hidden="true">{illu}</div>}
      <p className="ui-empty__title">{title}</p>
      {message && <p className="ui-empty__message">{message}</p>}
      {(action || secondaryAction) && (
        <div className="ui-empty__actions">
          {action && (
            <Button size={compact ? 'sm' : 'md'} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button size={compact ? 'sm' : 'md'} variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

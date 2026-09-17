import React from 'react';

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
        fill="var(--ikan-primary-soft)" />
      <rect x="22" y="32" width="60" height="8" rx="4"
        fill="var(--ikan-border)" />
      <rect x="22" y="46" width="40" height="6" rx="3"
        fill="var(--ikan-border)" opacity="0.6" />
      <rect x="22" y="58" width="50" height="6" rx="3"
        fill="var(--ikan-border)" opacity="0.4" />
      <circle cx="90" cy="68" r="18"
        fill="var(--ikan-bg)" stroke="var(--ikan-border)" strokeWidth="1.5" />
      <path d="M84 68 h12 M90 62 v12"
        stroke="var(--ikan-text-soft)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
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
        fill="var(--ikan-success-bg)" />
      <path
        d="M44 52 L55 63 L77 38"
        stroke="var(--ikan-success)"
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
        fill="var(--ikan-primary-soft)" />
      <path
        d="M14 54 C14 62 30 76 60 76 C90 76 106 62 106 54"
        fill="var(--ikan-bg)"
      />
      <rect x="30" y="32" width="60" height="7" rx="3.5"
        fill="var(--ikan-border)" />
      <rect x="38" y="44" width="44" height="5" rx="2.5"
        fill="var(--ikan-border)" opacity="0.55" />
      {/* Bulles de dialogue */}
      <circle cx="55" cy="70" r="4" fill="var(--ikan-primary-soft)" />
      <circle cx="66" cy="74" r="3" fill="var(--ikan-primary-soft)" />
      <circle cx="75" cy="76" r="2" fill="var(--ikan-primary-soft)" />
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
        fill="var(--ikan-primary-soft)" />
      <circle cx="60" cy="45" r="16"
        fill="var(--ikan-bg)" stroke="var(--ikan-border)" strokeWidth="1.5" />
      <path d="M60 37 v9 M60 49 v2"
        stroke="var(--ikan-text-soft)" strokeWidth="2.5"
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
export interface EmptyStateProps {
  /** Titre principal affiché en gras */
  title: string;
  /** Sous-texte explicatif */
  message?: string;
  /**
   * Clé de l'illustration :
   *  'no-data' | 'no-alert' | 'no-feedback' | ReactNode personnalisé
   */
  illustration?: string | React.ReactNode;
  /** Bouton d'action optionnel */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Centrage vertical si dans un plein écran */
  fullHeight?: boolean;
}

// ── Composant ────────────────────────────────────────────────────
export default function EmptyState({
  title,
  message,
  illustration = 'no-data',
  action,
  fullHeight = false,
}: EmptyStateProps) {
  const illu =
    typeof illustration === 'string'
      ? ILLUSTRATIONS[illustration] ?? <IllustrationDefault />
      : illustration;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        gap: '16px',
        ...(fullHeight ? { minHeight: '360px' } : {}),
      }}
    >
      {/* Illustration */}
      <div style={{ marginBottom: '4px' }}>{illu}</div>

      {/* Titre */}
      <p
        style={{
          margin: 0,
          fontSize: '1rem',
          fontWeight: 800,
          color: 'var(--ikan-ink)',
          lineHeight: 1.3,
        }}
      >
        {title}
      </p>

      {/* Message */}
      {message && (
        <p
          style={{
            margin: 0,
            fontSize: '0.88rem',
            color: 'var(--ikan-text-soft)',
            lineHeight: 1.55,
            maxWidth: '340px',
            fontWeight: 500,
          }}
        >
          {message}
        </p>
      )}

      {/* Action */}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: '4px',
            padding: '10px 22px',
            background: 'var(--ikan-ink)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--ikan-radius-pill)',
            fontSize: '0.88rem',
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

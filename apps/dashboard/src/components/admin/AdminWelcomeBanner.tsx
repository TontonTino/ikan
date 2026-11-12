import React from 'react';
import DashboardIllustration from '../common/DashboardIllustration';

interface AdminWelcomeBannerProps {
  userName?: string;
  subtitle?: string;
}

export default function AdminWelcomeBanner({
  userName = 'Système',
  subtitle = 'Voici un aperçu de vos organisations et CX Managers sur la plateforme IKAN AI.',
}: AdminWelcomeBannerProps) {
  // Formatage de la date en français, ex : "JEUDI 27 AOÛT 2026"
  const formattedDate = React.useMemo(() => {
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
      return 'JEUDI 27 AOÛT 2026';
    }
  }, []);

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: '24px',
        border: '1px solid var(--color-trait)',
        padding: '28px 36px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        gap: '24px',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Côté Gauche : Date, Titre et Sous-titre */}
      <div style={{ zIndex: 2, maxWidth: '640px', minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-bon-texte)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>{formattedDate}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
            Bonjour {userName}
          </h1>
        </div>

        <p
          style={{
            color: 'var(--color-text-2)',
            fontSize: 'var(--text-base)',
            marginTop: '8px',
            marginBottom: 0,
            fontWeight: 'var(--weight-normal)',
            lineHeight: 1.45,
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Côté Droit : Illustration Moderne */}
      <div
        style={{
          zIndex: 2,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <DashboardIllustration width={220} height={140} />
      </div>

    </div>
  );
}

import React from 'react';
import DashboardIllustration from '../common/DashboardIllustration';
import { SparklesIcon } from '../common/Icons';

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
        background: 'linear-gradient(135deg, #F4FAF5 0%, #EBF6ED 100%)',
        borderRadius: '24px',
        border: '1px solid #D6E8D9',
        boxShadow: '0 4px 20px rgba(2, 48, 45, 0.04)',
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
            fontSize: '0.74rem',
            fontWeight: 800,
            color: '#4B7B47',
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
              fontSize: '1.95rem',
              fontWeight: 800,
              color: '#02302D',
              margin: 0,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            Bonjour {userName}
          </h1>
          <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>✨</span>
        </div>

        <p
          style={{
            color: '#526E60',
            fontSize: '0.94rem',
            marginTop: '8px',
            marginBottom: 0,
            fontWeight: 500,
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

      {/* Décoration d'arrière-plan très subtile */}
      <div
        style={{
          position: 'absolute',
          top: '-40px',
          right: '-40px',
          width: '200px',
          height: '200px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(117, 183, 42, 0.12) 0%, rgba(255,255,255,0) 70%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

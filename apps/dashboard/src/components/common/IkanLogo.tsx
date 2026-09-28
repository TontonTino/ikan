import React from 'react';

interface LogoProps {
  variant?: 'light' | 'dark' | 'lime';
  size?: number;
  showText?: boolean;
}

export default function IkanLogo({ variant = 'dark', size = 38, showText = true }: LogoProps) {
  const isDarkBg = variant === 'light';
  const textColor = isDarkBg ? '#FFFFFF' : '#02302D';
  // Sur fond sombre, /logo.png contient un texte "IKAN AI" noir incrusté
  // dans l'image, quasi invisible — on utilise l'icône seule (cube) à la
  // place ; le texte "ikanai" est alors porté par le <span> ci-dessous.
  const logoSrc = isDarkBg ? '/logo-ikan-ai-icon.svg' : '/logo.png';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
      {/* Logo IKAN AI officiel */}
      <img
        src={logoSrc}
        alt={showText ? '' : 'IKAN AI'}
        style={{
          height: `${size}px`,
          width: 'auto',
          objectFit: 'contain',
          display: 'block',
          flexShrink: 0,
        }}
      />

      {showText && (
        <span style={{
          fontSize: `${size * 0.58}px`,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: textColor,
          fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
          lineHeight: 1,
          display: 'flex',
          alignItems: 'baseline',
        }}>
          ikan<span style={{ color: '#75B72A' }}>ai</span>
        </span>
      )}
    </div>
  );
}

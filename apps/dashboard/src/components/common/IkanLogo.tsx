import React from 'react';

interface LogoProps {
  variant?: 'light' | 'dark' | 'lime';
  size?: number;
  showText?: boolean;
}

export default function IkanLogo({ variant = 'dark', size = 38, showText = true }: LogoProps) {
  const isDarkBg = variant === 'light';
  const textColor = isDarkBg ? '#FFFFFF' : '#02302D';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
      {/* Logo IKAN AI officiel */}
      <img
        src="/logo.png"
        alt="IKAN AI"
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

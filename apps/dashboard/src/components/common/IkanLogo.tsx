import React from 'react';

interface LogoProps {
  variant?: 'light' | 'dark' | 'lime';
  size?: number;
  showText?: boolean;
}

export default function IkanLogo({ variant = 'dark', size = 38, showText = true }: LogoProps) {
  const isDarkBg = variant === 'light';
  const logoSrc = showText
    ? (isDarkBg ? '/ikanai-logo-horizontal-white.png' : '/ikanai-logo-horizontal.png')
    : (isDarkBg ? '/ikanai-mark-white.png' : '/ikanai-mark.png');

  return (
    <img
      src={logoSrc}
      alt="IKAN AI"
      style={{ height: `${size}px`, width: 'auto', objectFit: 'contain', display: 'block', flexShrink: 0 }}
    />
  );
}

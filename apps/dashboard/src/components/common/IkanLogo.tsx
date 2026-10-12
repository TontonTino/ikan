import React from 'react';

interface LogoProps {
  variant?: 'light' | 'dark' | 'green' | 'lime';
  size?: number;
  showText?: boolean;
}

export default function IkanLogo({ variant = 'dark', size = 38, showText = true }: LogoProps) {
  const isDarkBg = variant === 'light';
  // La variante blanche officielle est le symbole seul ; ne reconstruis pas
  // un mot-symbole blanc qui ne fait pas partie du jeu de logos validé.
  const logoSrc = isDarkBg
    ? '/ikanai-mark-white.png'
    : variant === 'green'
      ? '/ikanai-logo-horizontal-green.png'
      : variant === 'lime'
      ? '/ikanai-logo-horizontal-lime.png'
      : showText
        ? '/ikanai-logo-horizontal.png'
        : '/ikanai-mark.png';

  return (
    <img
      src={logoSrc}
      alt="IKAN AI"
      style={{ height: `${size}px`, width: 'auto', objectFit: 'contain', display: 'block', flexShrink: 0 }}
    />
  );
}

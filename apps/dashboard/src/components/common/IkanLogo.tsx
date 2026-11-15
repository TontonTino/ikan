import React from 'react';

/**
 * Logo IKAN AI : uniquement les variantes officielles.
 *  - logo horizontal (texte noir) sur fond clair ; logo horizontal blanc sur fond foncé (menu) ;
 *  - le cube seul (symbole, en couleurs ou blanc) là où un logo avec texte serait illisible : menu replié, icône d'onglet.
 * Les anciennes variantes à texte vert ou citron ne font pas partie de la charte et ont été retirées.
 */
interface LogoProps {
  /** `light` : logo clair, pour un fond foncé (le menu). `dark` : logo foncé, pour un fond clair. */
  variant?: 'light' | 'dark';
  size?: number;
  /** false : le cube seul (menu replié). */
  showText?: boolean;
}

export const SOURCES_LOGO = {
  horizontal: '/ikanai-logo-horizontal.png',
  horizontalBlanc: '/ikanai-logo-horizontal-white.png',
  cube: '/ikanai-mark.png',
  cubeBlanc: '/ikanai-mark-white.png',
} as const;

export function sourceLogo(variant: 'light' | 'dark', showText: boolean): string {
  if (variant === 'light') return showText ? SOURCES_LOGO.horizontalBlanc : SOURCES_LOGO.cubeBlanc;
  return showText ? SOURCES_LOGO.horizontal : SOURCES_LOGO.cube;
}

export default function IkanLogo({ variant = 'dark', size = 38, showText = true }: LogoProps) {
  return (
    <img
      src={sourceLogo(variant, showText)}
      alt="IKAN AI"
      style={{ height: `${size}px`, width: 'auto', objectFit: 'contain', display: 'block', flexShrink: 0 }}
    />
  );
}

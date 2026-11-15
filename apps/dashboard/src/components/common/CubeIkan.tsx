import React from 'react';

/**
 * Le cube du logo IKAN AI en vectoriel (une seule couleur : currentColor). Tracé tiré des contours du logo officiel
 * (public/ikanai-mark.png), simplifié en polygones : net à toutes les tailles, quelques centaines d'octets.
 * Décoratif : toujours masqué aux lecteurs d'écran.
 */
export default function CubeIkan({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 253 289" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M138,289.5 L137.5,140 L10.5,67 L127,-0.5 L253.5,71 L253.5,222 Z M186.5,206 L205.5,195 L205.5,99 L127,54.5 L107.5,67 L184.5,112 L184.5,206 Z M115,287.5 L-0.5,221 L0,86.5 L115.5,152 Z"
      />
    </svg>
  );
}

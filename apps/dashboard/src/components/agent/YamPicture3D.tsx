import React from 'react';

/**
 * Rendu 3D détouré de YAM (WebP, repli PNG ; @2x pour les écrans denses). Dimensions explicites : aucun saut de mise en page au chargement.
 * Ratio du fichier : 438 × 640.
 */
const RATIO = 640 / 438;

export default function YamPicture3D({ largeur = 110, alt = 'YAM' }: { largeur?: number; alt?: string }) {
  const hauteur = Math.round(largeur * RATIO);
  return (
    <picture>
      <source type="image/webp" srcSet="/yam/yam-3d-face.webp 1x, /yam/yam-3d-face@2x.webp 2x" />
      <img
        src="/yam/yam-3d-face.png"
        srcSet="/yam/yam-3d-face.png 1x, /yam/yam-3d-face@2x.png 2x"
        alt={alt}
        width={largeur}
        height={hauteur}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{ display: 'block', width: largeur, height: 'auto', aspectRatio: `${largeur} / ${hauteur}` }}
      />
    </picture>
  );
}

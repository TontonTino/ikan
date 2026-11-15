import React, { useState } from 'react';
import YamMascot from './YamMascot';
import yamPng from '../../assets/yam/yam-3d-face.png';
import yamPng2x from '../../assets/yam/yam-3d-face@2x.png';
import yamWebp from '../../assets/yam/yam-3d-face.webp';
import yamWebp2x from '../../assets/yam/yam-3d-face@2x.webp';

/**
 * Rendu 3D détouré de YAM (WebP, repli PNG ; @2x pour les écrans denses). Dimensions explicites : aucun saut de mise en page.
 * Les fichiers sont IMPORTÉS (src/assets/yam) : le build les place dans assets/ avec le reste de l'application, au lieu
 * d'un dossier public à part qu'un envoi incomplet pouvait oublier (image cassée vue en production).
 * Si l'image ne charge pas malgré tout, la mascotte dessinée prend sa place : jamais d'icône d'image cassée.
 * Ratio du fichier : 438 × 640.
 */
const RATIO = 640 / 438;
export const SOURCES_YAM_3D = { png: yamPng, png2x: yamPng2x, webp: yamWebp, webp2x: yamWebp2x };

export default function YamPicture3D({ largeur = 110, alt = 'YAM' }: { largeur?: number; alt?: string }) {
  const [enErreur, setEnErreur] = useState(false);
  const hauteur = Math.round(largeur * RATIO);
  if (enErreur) return <YamMascot variant="corps" state="accueil" size={largeur} title={alt || undefined} />;
  return (
    <picture>
      <source type="image/webp" srcSet={`${yamWebp} 1x, ${yamWebp2x} 2x`} />
      <img
        src={yamPng}
        srcSet={`${yamPng} 1x, ${yamPng2x} 2x`}
        alt={alt}
        width={largeur}
        height={hauteur}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setEnErreur(true)}
        style={{ display: 'block', width: largeur, height: 'auto', aspectRatio: `${largeur} / ${hauteur}` }}
      />
    </picture>
  );
}

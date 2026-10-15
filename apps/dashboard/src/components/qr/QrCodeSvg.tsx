import React, { useMemo } from 'react';
import { QR_COULEUR_CLAIRE, QR_COULEUR_SOMBRE, cheminSvgQr, creerMatriceQr } from '../../utils/qrCode';

/** QR code en SVG vectoriel, généré localement. Le dessin ne contient que la géométrie (aucun texte, aucune autre donnée). */
export default function QrCodeSvg({ url, taille, titre, style }: { url: string; taille: number | string; titre: string; style?: React.CSSProperties }) {
  const { chemin, cote } = useMemo(() => cheminSvgQr(creerMatriceQr(url)), [url]);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${cote} ${cote}`}
      width={taille}
      height={taille}
      role="img"
      aria-label={titre}
      shapeRendering="crispEdges"
      style={style}
    >
      <rect width={cote} height={cote} fill={QR_COULEUR_CLAIRE} />
      <path d={chemin} fill={QR_COULEUR_SOMBRE} />
    </svg>
  );
}

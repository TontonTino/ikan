/**
 * IkanLogo — Dashboard (React / Vite)
 *
 * Affiche le logo IKAN AI depuis public/logo-ikan-ai.svg.
 * Pour remplacer par le logo officiel : déposer le fichier SVG dans
 * apps/dashboard/public/logo-ikan-ai.svg — aucun autre changement requis.
 *
 * Règles de la charte :
 *  - Taille minimale : 32px de haut
 *  - Ne jamais déformer ni recolorer via CSS
 */

interface IkanLogoProps {
  /** Hauteur du logo en px (min 32). Par défaut : 36 */
  height?: number;
  className?: string;
}

export function IkanLogo({ height = 36, className }: IkanLogoProps) {
  // ratio viewBox 160×40 → width = height × 4
  const width = height * 4;

  return (
    <img
      src="/logo-ikan-ai.svg"
      alt="IKAN AI"
      width={width}
      height={height}
      className={className}
      style={{ minHeight: 32, display: 'block' }}
      draggable={false}
    />
  );
}

export default IkanLogo;

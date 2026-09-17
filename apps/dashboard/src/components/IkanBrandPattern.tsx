/**
 * IkanBrandPattern — Motif de fond branding IKAN AI (React)
 *
 * Cube isométrique en filigrane, répété en diagonale.
 * Usage : panneaux branding, page login, splash screens.
 *
 * Le parent doit avoir position: relative (ou absolute/fixed).
 */

interface IkanBrandPatternProps {
  /** Opacité du motif — spec 4-6%, défaut 0.05 */
  opacity?: number;
  /** Couleur du cube, défaut #3C7730 sur fond #02302D */
  color?: string;
  className?: string;
}

export function IkanBrandPattern({
  opacity = 0.05,
  color = '#3C7730',
  className,
}: IkanBrandPatternProps) {
  const patternId = 'ikan-brand-pattern';

  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          x="0"
          y="0"
          width="64"
          height="64"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-30)"
        >
          {/* Face dessus */}
          <polygon
            points="32,8 48,17 32,26 16,17"
            fill={color}
            opacity={opacity}
          />
          {/* Face gauche */}
          <polygon
            points="16,17 32,26 32,44 16,35"
            fill={color}
            opacity={opacity * 0.75}
          />
          {/* Face droite */}
          <polygon
            points="48,17 32,26 32,44 48,35"
            fill={color}
            opacity={opacity * 0.5}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

export default IkanBrandPattern;

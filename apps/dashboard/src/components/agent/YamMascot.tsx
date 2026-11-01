import React, { useId } from 'react';

/**
 * Mascotte YAM en SVG (petites tailles et états). Ne remplace pas YamAvatar : composant à part, pas encore branché dans les pages.
 *
 * Le dessin reproduit la géométrie validée (viewBox corps « 0 -4 120 144 », tête « 18 -4 104 100 »). Aucun texte dans le SVG : le nom accessible
 * passe par `title` (role="img" + aria-label) ; sans `title`, le SVG est décoratif (aria-hidden). Aucune animation.
 * Variante « tête » : le tronc est simplement recadré ; ombre, bras et jambes ne sont pas dessinés (ils seraient coupés par le cadre).
 */
export type YamEtat = 'accueil' | 'reflexion' | 'alerte' | 'resolu';
export type YamVariante = 'corps' | 'tete';

export interface YamMascotProps {
  state?: YamEtat;
  variant?: YamVariante;
  /** Hauteur en pixels (la largeur suit le cadre du dessin). */
  size?: number;
  /** Nom accessible. Absent : SVG décoratif. */
  title?: string;
}

// Teintes propres au personnage (hors tokens)
export const YAM_CORPS_CLAIR = '#9bd84a';
export const YAM_CORPS_FONCE = '#5fa526';
export const YAM_JOUES = '#f4a58a';
const YAM_BRAS = '#69af2d';
const YAM_FEUILLE_GAUCHE = '#2f6a26';
const YAM_OEIL = '#10211d';
const YAM_BADGE_ALERTE = '#d6452d';
// Teintes qui correspondent à des tokens du design system (valeur de repli = valeur du token)
const TIGE_ET_FEUILLE = { fill: 'var(--color-primary, #3c7730)' } as const;
const TRAIT_BOUCHE = 'var(--color-primary-dark, #02302d)';

const CADRES: Record<YamVariante, { viewBox: string; largeur: number; hauteur: number }> = {
  corps: { viewBox: '0 -4 120 144', largeur: 120, hauteur: 144 },
  // Élargi à droite (104 au lieu de 96) : la 3e pastille de « réflexion » (x = 116, r = 4) va jusqu'à x = 120.
  tete: { viewBox: '18 -4 104 100', largeur: 104, hauteur: 100 },
};

function Oeil({ x, y }: { x: number; y: number }) {
  return (
    <>
      <ellipse cx={x} cy={y} rx={5.2} ry={6.8} fill={YAM_OEIL} />
      <ellipse cx={x + 1.8} cy={y - 2.4} rx={1.8} ry={2} fill="#fff" />
    </>
  );
}

function Visage({ state }: { state: YamEtat }) {
  const trait = { stroke: TRAIT_BOUCHE, strokeWidth: 2.6, strokeLinecap: 'round' as const, fill: 'none' };
  switch (state) {
    case 'reflexion':
      return (
        <>
          <Oeil x={48} y={61} />
          <Oeil x={76} y={61} />
          <ellipse cx={62} cy={81} rx={3} ry={3.4} fill={TRAIT_BOUCHE} />
          <circle cx={102} cy={34} r={3} style={TIGE_ET_FEUILLE} />
          <circle cx={110} cy={25} r={4} style={TIGE_ET_FEUILLE} />
          <circle cx={116} cy={14} r={4} style={TIGE_ET_FEUILLE} />
        </>
      );
    case 'alerte':
      return (
        <>
          <Oeil x={46} y={68} />
          <Oeil x={74} y={68} />
          <path d="M36 55 L55 61 M84 55 L65 61" stroke={YAM_OEIL} strokeWidth={3} strokeLinecap="round" fill="none" />
          <path d="M53 84 Q60 79 67 84" {...trait} />
          <circle cx={98} cy={30} r={13} fill={YAM_BADGE_ALERTE} />
          <rect x={96.5} y={21} width={3} height={11} rx={1.5} fill="#fff" />
          <circle cx={98} cy={37} r={2} fill="#fff" />
        </>
      );
    case 'resolu':
      return (
        <>
          <path d="M39 68 Q46 59 53 68 M67 68 Q74 59 81 68" stroke={YAM_OEIL} strokeWidth={3} strokeLinecap="round" fill="none" />
          <path d="M50 78 Q60 92 70 78Z" fill={TRAIT_BOUCHE} />
          <circle cx={98} cy={30} r={13} style={TIGE_ET_FEUILLE} />
          <path d="M91.5 30 L96.5 35 L105 24" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      );
    default:
      return (
        <>
          <Oeil x={46} y={66} />
          <Oeil x={74} y={66} />
          <path d="M52 80 Q60 87 68 80" {...trait} />
        </>
      );
  }
}

export default function YamMascot({ state = 'accueil', variant = 'corps', size = 96, title }: YamMascotProps) {
  // useId : un identifiant PAR INSTANCE (plusieurs YAM peuvent coexister) ; les « : » de React sont retirés pour url(#…).
  const idDegrade = `yam-degrade-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const cadre = CADRES[variant];
  const accessible = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={cadre.viewBox}
      width={(size * cadre.largeur) / cadre.hauteur}
      height={size}
      focusable="false"
      data-yam-state={state}
      data-yam-variant={variant}
      {...accessible}
    >
      <defs>
        <radialGradient id={idDegrade} cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor={YAM_CORPS_CLAIR} />
          <stop offset="1" stopColor={YAM_CORPS_FONCE} />
        </radialGradient>
      </defs>

      {variant === 'corps' && (
        <>
          <ellipse cx={60} cy={135} rx={30} ry={4} fill="#000" fillOpacity={0.08} />
          <rect x={42} y={116} width={14} height={16} rx={7} fill={YAM_CORPS_FONCE} />
          <rect x={64} y={116} width={14} height={16} rx={7} fill={YAM_CORPS_FONCE} />
          <ellipse cx={24} cy={86} rx={8} ry={16} fill={YAM_BRAS} transform="rotate(8 24 86)" />
          <ellipse cx={96} cy={86} rx={8} ry={16} fill={YAM_BRAS} transform="rotate(-8 96 86)" />
        </>
      )}

      <path d="M60 22 C86 22 97 46 97 76 C97 106 87 122 60 122 C33 122 23 106 23 76 C23 46 34 22 60 22Z" fill={`url(#${idDegrade})`} />
      <ellipse cx={50} cy={42} rx={12} ry={8} fill="#fff" fillOpacity={0.18} />

      <path d="M60 23 Q59 14 61 8" fill="none" strokeWidth={3.5} strokeLinecap="round" style={{ stroke: 'var(--color-primary, #3c7730)' }} />
      <path d="M61 9 Q73 -1 86 7 Q74 20 61 9Z" style={TIGE_ET_FEUILLE} />
      <path d="M60 11 Q49 1 36 8 Q47 21 60 11Z" fill={YAM_FEUILLE_GAUCHE} />

      {state !== 'alerte' && (
        <>
          <ellipse cx={39} cy={82} rx={7} ry={5} fill={YAM_JOUES} fillOpacity={0.55} />
          <ellipse cx={81} cy={82} rx={7} ry={5} fill={YAM_JOUES} fillOpacity={0.55} />
        </>
      )}

      <Visage state={state} />
    </svg>
  );
}

import React from 'react';
import avatar from '../../assets/yam/yam-avatar-icon.png';

/** Image embarquée dans le bundle (comme le YAM 3D) : elle part avec l'application, quel que soit l'hébergeur. */
export const YAM_AVATAR_SRC = avatar;

export type YamAvatarEtat = 'reflexion' | 'alerte';

interface Props {
  size?: number;
  /** Légère pulsation en boucle (état « YAM réfléchit… »). */
  pulsing?: boolean;
  /** Petit repère posé sur l'avatar : « … » quand YAM réfléchit, « ! » quand il signale un problème. Toujours doublé d'un texte. */
  etat?: YamAvatarEtat;
}

/**
 * Avatar de YAM : la tête et la pousse du YAM 3D officiel dans un rond.
 * SEUL visage de YAM dans le dashboard (en-tête, panneau, bulles, synthèse, notes) : plus aucune mascotte dessinée à côté.
 */
export default function YamAvatar({ size = 36, pulsing = false, etat }: Props) {
  const rond = (
    <span
      aria-hidden="true"
      className={pulsing ? 'yam-avatar yam-avatar-pulse' : 'yam-avatar'}
      style={{ width: size, height: size }}
    >
      <img src={YAM_AVATAR_SRC} alt="" width={size} height={size} draggable={false} />
    </span>
  );
  if (!etat) return rond;
  return (
    <span aria-hidden="true" data-yam-state={etat} className="yam-avatar-etat" style={{ width: size, height: size }}>
      {rond}
      <i className={`yam-avatar-etat__repere yam-avatar-etat__repere--${etat}`}>{etat === 'alerte' ? '!' : '…'}</i>
    </span>
  );
}

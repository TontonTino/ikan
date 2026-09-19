import React from 'react';

export const YAM_AVATAR_SRC = '/yam-avatar-icon.png';

interface Props {
  size?: number;
  /** Légère pulsation en boucle (état « YAM réfléchit… »). */
  pulsing?: boolean;
}

/**
 * Avatar de YAM : le visage de la mascotte dans un conteneur rond.
 * Seul point d'affichage de l'avatar dans le dashboard (bouton de la sidebar,
 * en-tête du panneau, bulles de chat, indicateur d'attente).
 */
export default function YamAvatar({ size = 36, pulsing = false }: Props) {
  return (
    <span
      aria-hidden="true"
      className={pulsing ? 'yam-avatar yam-avatar-pulse' : 'yam-avatar'}
      style={{ width: size, height: size }}
    >
      <img src={YAM_AVATAR_SRC} alt="" width={size} height={size} draggable={false} />
    </span>
  );
}

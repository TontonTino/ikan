import React from 'react';
import { YAM_PRESENCE } from '../../config';
import { FAIBLE_VOLUME_POINT } from '../../pages/cx/siege/siegeData';
import YamMascot from './YamMascot';
import './yamPresence.css';

/**
 * Note d'honnêteté sous le graphique « Évolution de la satisfaction » : affichée UNIQUEMENT si au moins un point est déjà marqué
 * « faible volume » par la logique existante du graphique (le nombre est calculé par l'appelant avec FAIBLE_VOLUME_POINT).
 */
export default function YamNote({ pointsFaibleVolume }: { pointsFaibleVolume: number }) {
  if (!YAM_PRESENCE || !(pointsFaibleVolume > 0)) return null;
  return (
    <div className="yam-note" role="note">
      <YamMascot variant="tete" state="reflexion" size={30} />
      <p>
        <strong>Trop peu d’avis pour conclure.</strong> Plusieurs jours comptent moins de {FAIBLE_VOLUME_POINT} avis : le pourcentage varie
        beaucoup sans que la situation change. Je ne tire pas de tendance de ces points.
      </p>
    </div>
  );
}

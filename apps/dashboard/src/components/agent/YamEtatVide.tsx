import React from 'react';
import { YAM_PRESENCE } from '../../config';
import Button from '../ui/Button';
import YamPicture3D from './YamPicture3D';
import './yamPresence.css';

export interface YamEtatVideProps {
  titre: string;
  texte: string;
  action?: { label: string; onClick: () => void };
}

/** État vide réutilisable avec YAM en grand (rendu 3D). Sans présence de YAM (drapeau coupé), ne rend rien : l'appelant garde son état vide. */
export default function YamEtatVide({ titre, texte, action }: YamEtatVideProps) {
  if (!YAM_PRESENCE) return null;
  return (
    <div className="yam-etat-vide">
      <YamPicture3D largeur={120} alt="" />
      <h3 className="yam-etat-vide__titre">{titre}</h3>
      <p className="yam-etat-vide__texte">{texte}</p>
      {action && <Button variant="primary" onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

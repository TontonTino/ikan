import React from 'react';
import YamAvatar from '../agent/YamAvatar';
import { YAM_PANEL_ID } from '../agent/YamChatPanel';

/**
 * « Demander à YAM », en haut à droite de l'en-tête (il était en bas du menu latéral ; le compte y a pris sa place).
 * Même forme de pastille que l'ancien menu du compte. Sur petit écran, l'avatar seul (le nom accessible reste).
 * Ouvre et ferme le panneau de YAM ; ne change pas de page.
 */
export default function YamBoutonEntete({ ouvert, onBasculer }: { ouvert: boolean; onBasculer: () => void }) {
  return (
    <button
      type="button"
      onClick={onBasculer}
      aria-expanded={ouvert}
      aria-controls={YAM_PANEL_ID}
      aria-label="Demander à YAM, assistant IA"
      className={`yam-entete${ouvert ? ' yam-entete--ouvert' : ''}`}
    >
      <YamAvatar size={30} />
      <span className="yam-entete__libelle" aria-hidden="true">Demander à YAM</span>
    </button>
  );
}

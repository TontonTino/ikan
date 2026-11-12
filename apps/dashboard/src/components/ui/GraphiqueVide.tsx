import React from 'react';

export interface ElargirPeriode {
  /** Libellé du lien, ex. « Voir sur 30 jours ». */
  label: string;
  onClick: () => void;
}

/**
 * État vide d'un graphique : une phrase courte, et un lien vers une période plus large quand la page en propose une.
 * Remplace le cadre vide de pleine hauteur : la page ne réserve pas d'espace pour un graphique qui n'a rien à tracer.
 */
export default function GraphiqueVide({ message, elargir }: { message: string; elargir?: ElargirPeriode }) {
  return (
    <p className="ui-graphique-vide" role="status">
      {message}
      {elargir && (
        <>
          {' '}
          <button type="button" className="ui-graphique-vide__lien" onClick={elargir.onClick}>{elargir.label}</button>
        </>
      )}
    </p>
  );
}

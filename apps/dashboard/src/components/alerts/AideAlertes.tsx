import React, { useEffect, useId, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import { useMediaQuery } from '../ui/useMediaQuery';

export const AIDE_ALERTES_TITRE = 'Comment lire cette page';

/** Même seuil que les règles mobiles de la page (agence.css) : en dessous, l'aide s'ouvre en feuille modale. */
export const AIDE_MOBILE_QUERY = '(max-width: 640px)';

/** Texte de l'aide : l'ancien encadré et la phrase de l'en-tête, réunis. Aucune règle décrite ici n'est nouvelle. */
export function AideAlertesContenu() {
  return (
    <>
      <p>
        Les alertes sont recalculées à chaque ouverture : elles n’ont pas d’état « lu » ou « traité » et disparaissent d’elles-mêmes quand la situation redevient normale.
      </p>
      <p>Une alerte signale une situation ; elle ne crée pas de problème à traiter : c’est vous qui décidez d’en créer un.</p>
    </>
  );
}

/** Quand l'aide est ouverte, seule la touche Échap la ferme. */
export const ouvertApresTouche = (ouvert: boolean, touche: string): boolean => (touche === 'Escape' ? false : ouvert);
/** Un clic hors du déclencheur et du panneau ferme l'aide. */
export const ouvertApresClic = (ouvert: boolean, dansLeConteneur: boolean): boolean => (dansLeConteneur ? ouvert : false);

/**
 * Lien discret « Comment lire cette page », près du titre. Bureau : popover sous le lien (Échap et clic extérieur ferment, le focus reste ou revient
 * au déclencheur). Mobile : feuille modale du design system (focus piégé, Échap, focus rendu au déclencheur).
 */
export default function AideAlertes({ ouvertInitial = false }: { ouvertInitial?: boolean }) {
  const [ouvert, setOuvert] = useState(ouvertInitial);
  const mobile = useMediaQuery(AIDE_MOBILE_QUERY);
  const panneauId = useId();
  const conteneur = useRef<HTMLSpanElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!ouvert || mobile) return;
    const surTouche = (e: KeyboardEvent) => {
      if (ouvertApresTouche(true, e.key) === false) {
        setOuvert(false);
        declencheur.current?.focus();
      }
    };
    const surClic = (e: MouseEvent) => {
      if (ouvertApresClic(true, !!conteneur.current?.contains(e.target as Node)) === false) setOuvert(false);
    };
    document.addEventListener('keydown', surTouche);
    document.addEventListener('mousedown', surClic);
    return () => {
      document.removeEventListener('keydown', surTouche);
      document.removeEventListener('mousedown', surClic);
    };
  }, [ouvert, mobile]);

  return (
    <span className="alerte-aide" ref={conteneur}>
      <button
        ref={declencheur}
        type="button"
        className="alerte-aide__btn"
        aria-expanded={ouvert}
        aria-controls={panneauId}
        aria-haspopup="dialog"
        onClick={() => setOuvert((v) => !v)}
      >
        {AIDE_ALERTES_TITRE}
      </button>
      {ouvert && !mobile && (
        <div id={panneauId} className="alerte-aide__panneau" role="dialog" aria-label={AIDE_ALERTES_TITRE}>
          <AideAlertesContenu />
        </div>
      )}
      {mobile && (
        <Modal open={ouvert} onClose={() => setOuvert(false)} title={AIDE_ALERTES_TITRE} size="sm">
          <div id={panneauId} className="alerte-aide__corps">
            <AideAlertesContenu />
          </div>
        </Modal>
      )}
    </span>
  );
}

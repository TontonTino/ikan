import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../../stores/authStore';
import type { IssueDetail } from '../../types';
import IconButton from '../ui/IconButton';
import Button from '../ui/Button';
import { ArrowLeftIcon, XCloseIcon } from '../common/Icons';
import { useOverlay } from '../ui/useOverlay';
import IssueDetailContenu, { PiedProbleme } from './IssueDetailContenu';

export type ModePanneau = 'ancre' | 'plein';

interface Props {
  /** Détail chargé ; null pendant le chargement. */
  issue: IssueDetail | null;
  loading: boolean;
  /** Titre et agence connus par la ligne de la liste : affichés dès l'ouverture, avant l'arrivée du détail. */
  titreProvisoire?: string;
  agenceProvisoire?: string;
  /**
   * 'ancre' (≥ 1024 px) : le panneau est posé à côté de la liste, qui reste visible et utilisable (pas de voile, pas de piège de focus).
   * 'plein' (tablette, mobile) : vue plein écran avec un retour clair vers la liste ; focus piégé, Échap ferme.
   */
  mode: ModePanneau;
  onClose: () => void;
  onActionsChange: (issueId: string, message: string) => void | Promise<void>;
  onVerifier: (issueId: string) => void | Promise<void>;
  onOuvrirOrigine?: (issueId: string) => void;
}

/**
 * Panneau de détail d'un problème. Ancré : `complementary` (région nommée) ; plein écran : `dialog`. Échap ferme (focus rendu à la ligne par la liste) ;
 * les boîtes ouvertes PAR-DESSUS (Définir une action, Terminer) gardent leur propre Échap et ne ferment pas le panneau.
 */
export default function PanneauProbleme({ issue, loading, titreProvisoire, agenceProvisoire, mode, onClose, onActionsChange, onVerifier, onOuvrirOrigine }: Props) {
  const role = useAuthStore((s) => s.user?.role);
  const racine = useRef<HTMLElement | null>(null);
  const panneauPlein = useOverlay<HTMLDivElement>(mode === 'plein', onClose);
  const titre = issue?.titre ?? titreProvisoire ?? 'Problème à traiter';
  const agence = issue?.agence_nom ?? agenceProvisoire;

  // Panneau ancré : à l'ouverture (et quand un autre problème s'y affiche) le focus entre dans le panneau, annoncé par son titre.
  const ouvert = issue?.id;
  useEffect(() => {
    if (mode === 'ancre') racine.current?.focus({ preventScroll: true });
  }, [mode, ouvert]);

  const corps = (
    <>
      <div className="pb-panneau__corps">
        <IssueDetailContenu issue={issue} loading={loading} onNaviguer={onClose} onActionsChange={onActionsChange} onOuvrirOrigine={onOuvrirOrigine} />
      </div>
      {!loading && issue && issue.statut === 'resolue' && (
        <footer className="pb-panneau__pied"><PiedProbleme issue={issue} role={role} onVerifier={onVerifier} /></footer>
      )}
    </>
  );

  if (mode === 'plein') {
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div className="pb-plein-racine">
        <div ref={panneauPlein} role="dialog" aria-modal="true" aria-labelledby="pb-panneau-titre" tabIndex={-1} className="pb-panneau pb-panneau--plein">
          <header className="pb-panneau__tete">
            <Button variant="ghost" icon={<ArrowLeftIcon size={16} />} onClick={onClose}>Retour à la liste</Button>
          </header>
          <div className="pb-panneau__titres">
            <h2 id="pb-panneau-titre" className="pb-panneau__titre">{titre}</h2>
            {agence && <p className="pb-panneau__sous-titre">{agence}</p>}
          </div>
          {corps}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <aside
      ref={racine as React.RefObject<HTMLElement>}
      role="complementary"
      aria-labelledby="pb-panneau-titre"
      tabIndex={-1}
      className="pb-panneau pb-panneau--ancre"
      onKeyDown={(e) => {
        // Seulement les touches venues du panneau lui-même : une boîte portée ailleurs dans le DOM (Définir / Terminer) gère son Échap.
        if (e.key === 'Escape' && e.currentTarget.contains(e.target as Node)) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="pb-panneau__tete pb-panneau__tete--titre">
        <div className="pb-panneau__titres">
          <h2 id="pb-panneau-titre" className="pb-panneau__titre">{titre}</h2>
          {agence && <p className="pb-panneau__sous-titre">{agence}</p>}
        </div>
        <IconButton label="Fermer le détail" icon={<XCloseIcon size={18} />} variant="ghost" onClick={onClose} />
      </header>
      {corps}
    </aside>
  );
}

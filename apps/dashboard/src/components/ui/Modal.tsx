import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import IconButton from './IconButton';
import { XCloseIcon } from '../common/Icons';
import { useOverlay } from './useOverlay';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Boutons d'action (alignés à droite). */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** false pour les décisions bloquantes : le clic sur le fond ne ferme pas. */
  dismissOnScrim?: boolean;
}

/**
 * Fenêtre modale : décision ou saisie courte qui bloque le reste de l'écran.
 * Pour consulter un détail sans perdre le contexte, préférer <Drawer>.
 * Focus piégé, Échap ferme, focus rendu au déclencheur. Sur mobile : bottom sheet.
 */
export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', dismissOnScrim = true }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useOverlay<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return createPortal(
    <div className="ui-modal-root">
      <div className="ui-scrim" aria-hidden="true" onClick={dismissOnScrim ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        tabIndex={-1}
        className={`ui-modal ui-modal--${size}`}
      >
        <header className="ui-overlay__header">
          <div className="ui-overlay__titles">
            <h2 id={titleId} className="ui-overlay__title">{title}</h2>
            {subtitle && <p id={descId} className="ui-overlay__subtitle">{subtitle}</p>}
          </div>
          <IconButton label="Fermer" icon={<XCloseIcon size={18} />} variant="ghost" onClick={onClose} showTooltip={false} />
        </header>
        <div className="ui-overlay__body">{children}</div>
        {footer && <footer className="ui-overlay__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

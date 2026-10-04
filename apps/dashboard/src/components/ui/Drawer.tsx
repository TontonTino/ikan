import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import IconButton from './IconButton';
import { ArrowLeftIcon, XCloseIcon } from '../common/Icons';
import { useOverlay } from './useOverlay';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
  /**
   * Retour au niveau précédent (Progressive Disclosure : KPI → agences →
   * thèmes → feedbacks) sans fermer le panneau ni perdre le contexte filtré.
   */
  onBack?: () => void;
  backLabel?: string;
}

/**
 * Panneau latéral (slide-over) : explorer un détail en gardant la page
 * visible derrière. Pile de navigation interne via `onBack`.
 */
export default function Drawer({ open, onClose, title, subtitle, children, footer, size = 'md', onBack, backLabel = 'Retour' }: DrawerProps) {
  const titleId = useId();
  const panelRef = useOverlay<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return createPortal(
    <div className="ui-drawer-root">
      <div className="ui-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`ui-drawer${size === 'lg' ? ' ui-drawer--lg' : ''}`}
      >
        <header className="ui-overlay__header">
          {onBack && <IconButton label={backLabel} icon={<ArrowLeftIcon size={18} />} variant="ghost" onClick={onBack} />}
          <div className="ui-overlay__titles">
            <h2 id={titleId} className="ui-overlay__title">{title}</h2>
            {subtitle && <p className="ui-overlay__subtitle">{subtitle}</p>}
          </div>
          <IconButton label="Fermer le panneau" icon={<XCloseIcon size={18} />} variant="ghost" onClick={onClose} showTooltip={false} />
        </header>
        <div className="ui-overlay__body">{children}</div>
        {footer && <footer className="ui-overlay__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

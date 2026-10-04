import React from 'react';
import Tooltip from './Tooltip';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Libellé accessible OBLIGATOIRE (lu par les lecteurs d'écran, affiché en tooltip). */
  label: string;
  icon: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'outline' | 'ghost';
  /** Affiche `label` en tooltip au survol / focus (défaut : true). */
  showTooltip?: boolean;
}

/**
 * Bouton icône seule. Le libellé est obligatoire : une icône n'est jamais
 * l'unique porteuse du sens. Zone cliquable étendue à 44×44 px pour sm/md.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', variant = 'outline', showTooltip = true, className, type = 'button', ...rest },
  ref,
) {
  const classes = ['ui-icon-btn', `ui-icon-btn--${size}`, variant === 'ghost' && 'ui-icon-btn--ghost', className]
    .filter(Boolean)
    .join(' ');

  const button = (
    <button ref={ref} type={type} className={classes} aria-label={label} {...rest}>
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span>
    </button>
  );

  return showTooltip ? <Tooltip content={label} decorative>{button}</Tooltip> : button;
});

export default IconButton;

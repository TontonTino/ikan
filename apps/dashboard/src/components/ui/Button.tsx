import React from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icône avant le libellé. */
  icon?: React.ReactNode;
  /** Icône après le libellé (ex. chevron, flèche). */
  iconEnd?: React.ReactNode;
  /** Affiche un spinner, désactive le clic et annonce l'état (aria-busy). */
  loading?: boolean;
  block?: boolean;
}

/**
 * Bouton du design system.
 * - primary : action principale de la zone (une seule par zone visible)
 * - accent  : mise en avant marque (lime), texte toujours foncé
 * - secondary / ghost : actions secondaires
 * - danger  : action destructive
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconEnd, loading = false, block = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const classes = ['ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, block && 'ui-btn--block', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon && <span className="ui-btn__icon" aria-hidden="true">{icon}</span>}
      {children}
      {iconEnd && !loading && <span className="ui-btn__icon" aria-hidden="true">{iconEnd}</span>}
    </button>
  );
});

export default Button;

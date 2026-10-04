import React from 'react';

export type CardTone = 'default' | 'critical' | 'warning' | 'success' | 'subtle';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Élément HTML rendu (section, article, li…). */
  as?: 'div' | 'section' | 'article' | 'li';
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Actions d'en-tête (filtres, menu, lien « Voir tout »). */
  actions?: React.ReactNode;
  padding?: 'none' | 'sm' | 'md';
  tone?: CardTone;
  /** Niveau du titre (h2 par défaut ; h3 dans une section déjà titrée). */
  headingLevel?: 2 | 3 | 4;
}

/**
 * Conteneur de base. Une carte cliquable reçoit role="button", tabIndex=0 et
 * l'activation Entrée/Espace (un <button> ne peut pas contenir de titres).
 * Si la carte contient d'autres contrôles, préférer un lien/bouton explicite
 * dans `actions` plutôt que onClick sur toute la carte.
 */
export default function Card({
  as,
  title,
  subtitle,
  actions,
  padding = 'md',
  tone = 'default',
  headingLevel = 2,
  className,
  children,
  onClick,
  onKeyDown,
  ...rest
}: CardProps) {
  const Tag = (as ?? 'div') as React.ElementType;
  const Heading = `h${headingLevel}` as React.ElementType;
  const classes = [
    'ui-card',
    padding !== 'md' && `ui-card--pad-${padding}`,
    tone !== 'default' && `ui-card--${tone}`,
    onClick && 'ui-card--interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      className={classes}
      onClick={onClick}
      {...(onClick
        ? {
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
              onKeyDown?.(e);
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e as unknown as React.MouseEvent<HTMLElement>);
              }
            },
          }
        : { onKeyDown })}
      {...rest}
    >
      {(title || actions) && (
        <div className="ui-card__header">
          <div style={{ minWidth: 0 }}>
            {title && <Heading className="ui-card__title">{title}</Heading>}
            {subtitle && <p className="ui-card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="ui-card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

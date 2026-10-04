import React from 'react';

export interface PageTitleProps {
  title: string;
  /** Une phrase : à quoi sert cette page (une destination = une fonction claire). */
  description?: string;
  /** Actions de page (export, filtres globaux…). */
  actions?: React.ReactNode;
  /** Indicateur à côté du titre (ex. compteur). */
  meta?: React.ReactNode;
}

/**
 * En-tête léger des pages de travail : laisse la place aux données.
 * Porte le <h1> unique de la page.
 */
export default function PageTitle({ title, description, actions, meta }: PageTitleProps) {
  return (
    <header className="ui-page-title">
      <div className="ui-page-title__text">
        <div className="ui-page-title__row">
          <h1 className="ui-page-title__h1">{title}</h1>
          {meta}
        </div>
        {description && <p className="ui-page-title__desc">{description}</p>}
      </div>
      {actions && <div className="ui-page-title__actions">{actions}</div>}
    </header>
  );
}

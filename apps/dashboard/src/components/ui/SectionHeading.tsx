import React from 'react';

/** Titre de groupe (<h2> sémantique, style discret) : un par niveau de lecture d'un dashboard. */
export default function SectionHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      style={{
        margin: 0,
        fontSize: '0.78rem',
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
      }}
    >
      {children}
    </h2>
  );
}

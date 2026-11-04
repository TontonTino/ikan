import React from 'react';

/** Section du détail d'un problème : titre en petites capitales, action facultative à droite du titre (ex. « Définir une action »). */
export default function SectionDetail({ titre, action, children }: { titre: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div className={action ? 'action-probleme__tete' : undefined}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: 0 }}>
          {titre}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

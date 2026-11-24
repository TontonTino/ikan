import React, { useState } from 'react';
import { ENTREES_DEMO, type RoleDemo } from '../services/demo';

interface Props {
  roles: RoleDemo[];
  /** Entre dans la démonstration ; rejette en cas d'échec (le message est affiché par la page de connexion). */
  onEntrer: (role: RoleDemo) => Promise<void>;
  desactive?: boolean;
}

/**
 * Entrée de la démonstration publique : un bouton par rôle, sans mot de passe.
 * Affiché au-dessus du formulaire de connexion, qui reste disponible pour l'équipe.
 */
export default function EntreeDemo({ roles, onEntrer, desactive = false }: Props) {
  const [enCours, setEnCours] = useState<RoleDemo | null>(null);

  if (!roles.length) return null;

  const entrer = async (role: RoleDemo) => {
    setEnCours(role);
    try {
      await onEntrer(role);
    } finally {
      setEnCours(null);
    }
  };

  return (
    <section aria-labelledby="entree-demo-titre" style={{ width: '100%' }}>
      <h3
        id="entree-demo-titre"
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--color-text-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          margin: '0 0 12px',
          textAlign: 'left',
        }}
      >
        Entrer comme
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {roles.map((role) => {
          const { titre, detail } = ENTREES_DEMO[role];
          const occupe = enCours !== null || desactive;
          return (
            <button
              key={role}
              type="button"
              className="entree-demo__bouton"
              data-role={role}
              disabled={occupe}
              aria-busy={enCours === role}
              onClick={() => entrer(role)}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, textAlign: 'left' }}>
                <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', fontSize: 'var(--text-base)' }}>
                  {enCours === role ? 'Ouverture…' : titre}
                </span>
                <span style={{ color: 'var(--color-text-2)', fontSize: 'var(--text-sm)' }}>{detail}</span>
              </span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ flexShrink: 0, color: 'var(--color-accent)' }}
              >
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </button>
          );
        })}
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', lineHeight: 1.5, textAlign: 'left' }}>
        Données fictives. Essayez tout librement : la démonstration est remise à zéro chaque nuit.
      </p>

      <div
        role="separator"
        aria-label="ou avec votre compte"
        style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '28px 0 24px' }}
      >
        <span style={{ flex: 1, height: '1px', background: 'var(--color-trait)' }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', whiteSpace: 'nowrap' }}>ou avec votre compte</span>
        <span style={{ flex: 1, height: '1px', background: 'var(--color-trait)' }} />
      </div>

      <style>{`
        .entree-demo__bouton {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 16px;
          background: var(--color-surface);
          border: 1px solid var(--color-trait);
          border-radius: 14px;
          font-family: inherit;
          cursor: pointer;
          transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }
        .entree-demo__bouton:hover:not(:disabled) { border-color: var(--color-accent); transform: translateY(-1px); }
        .entree-demo__bouton:focus-visible { outline: none; border-color: var(--color-accent); box-shadow: var(--focus-ring); }
        .entree-demo__bouton:disabled { cursor: not-allowed; opacity: 0.7; }
        @media (prefers-reduced-motion: reduce) { .entree-demo__bouton { transition: none; } .entree-demo__bouton:hover:not(:disabled) { transform: none; } }
      `}</style>
    </section>
  );
}

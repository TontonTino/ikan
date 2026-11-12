import React, { useState } from 'react';
import type { User } from '../../types';
import { ChevronDownIcon } from '../common/Icons';

interface OrgHeaderBadgeProps {
  user: User | null;
}

// Couleurs de fond harmonieuses pour l'avatar de remplacement
// Avatar de remplacement (initiales) : un seul style neutre de la palette, quelle que soit l'organisation.
// Les cinq teintes d'avant (orange, bleu, rose, violet…) n'avaient aucun rôle dans la palette.
const FALLBACK_PALETTES = [
  { bg: 'var(--color-neutre-fond)', text: 'var(--color-encre)', border: 'var(--color-neutre-fond)' },
];

function getPalette(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % FALLBACK_PALETTES.length;
  return FALLBACK_PALETTES[index];
}

export default function OrgHeaderBadge({ user }: OrgHeaderBadgeProps) {
  const [imgError, setImgError] = useState(false);

  if (!user) return null;

  // L'admin IKAN AI gère la plateforme de manière globale
  const isAdmin = user.role === 'admin';
  const orgName = user.organisation_nom || (isAdmin ? 'Plateforme IKAN AI' : 'Organisation');
  const orgLogo = !imgError ? user.organisation_logo : null;

  // Détermination du nom de l'espace selon le rôle
  let spaceName = 'Espace de travail';
  if (user.role === 'cx_manager') {
    spaceName = 'Espace Siège & Réseau';
  } else if (user.role === 'agency_manager') {
    spaceName = user.agence_nom ? `Agence ${user.agence_nom}` : 'Espace Agence';
  } else if (user.role === 'admin') {
    spaceName = 'Espace Administration';
  }

  const palette = getPalette(orgName);
  const initial = orgName.trim().charAt(0).toUpperCase() || 'O';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-trait)',
        borderRadius: '12px',
        padding: '5px 12px 5px 8px',
        boxShadow: 'var(--shadow-xs)',
        transition: 'all 0.15s ease',
        cursor: 'default',
        userSelect: 'none',
        maxWidth: '320px',
      }}
      title={`${orgName} — ${spaceName}`}
    >
      {/* ── Logo ou Avatar Dynamique Fallback ── */}
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          background: orgLogo ? 'var(--color-surface)' : palette.bg,
          border: `1px solid ${orgLogo ? 'var(--color-trait)' : palette.border}`,
          color: palette.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
          padding: orgLogo ? '3px' : 0,
          boxSizing: 'border-box',
        }}
      >
        {orgLogo ? (
          <img
            src={orgLogo}
            alt={orgName}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
          >
            {initial}
          </span>
        )}
      </div>

      {/* ── Texte Organisation & Espace ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minWidth: 0,
          lineHeight: 1.25,
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-encre)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '180px',
          }}
        >
          {orgName}
        </span>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-normal)',
            color: 'var(--color-text-2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '180px',
          }}
        >
          {spaceName}
        </span>
      </div>

      {/* ── Petit indicateur chevron discret Option 1 ── */}
      <div style={{ display: 'flex', alignItems: 'center', color: 'var(--color-text-2)', flexShrink: 0, marginLeft: '2px' }}>
        <ChevronDownIcon size={14} color="var(--color-text-2)" />
      </div>
    </div>
  );
}

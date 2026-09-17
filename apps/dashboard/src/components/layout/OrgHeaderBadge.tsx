import React, { useState } from 'react';
import type { User } from '../../types';
import { ChevronDownIcon } from '../common/Icons';

interface OrgHeaderBadgeProps {
  user: User | null;
}

// Couleurs de fond harmonieuses pour l'avatar de remplacement
const FALLBACK_PALETTES = [
  { bg: '#FFF3E6', text: '#D95D00', border: '#FFDEC0' }, // Orange / Amber
  { bg: '#EAF5EC', text: '#3C7730', border: '#D5E8D3' }, // Vert IKAN
  { bg: '#EFF6FF', text: '#2563EB', border: '#DBEAFE' }, // Bleu
  { bg: '#FDF2F8', text: '#DB2777', border: '#FCE7F3' }, // Rose / Violet
  { bg: '#F5F3FF', text: '#7C3AED', border: '#EDE9FE' }, // Indigo
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
  const orgName = user.organisation_nom || (isAdmin ? 'IKAN AI Platform' : 'Organisation');
  const orgLogo = !imgError ? user.organisation_logo : null;

  // Détermination du nom de l'espace selon le rôle
  let spaceName = 'Espace de Travail';
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
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: '12px',
        padding: '5px 12px 5px 8px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
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
          background: orgLogo ? '#FFFFFF' : palette.bg,
          border: `1px solid ${orgLogo ? '#E5E7EB' : palette.border}`,
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
              fontSize: '0.84rem',
              fontWeight: 800,
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
            fontSize: '0.82rem',
            fontWeight: 700,
            color: '#0F172A',
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
            fontSize: '0.68rem',
            fontWeight: 500,
            color: '#64748B',
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
      <div style={{ display: 'flex', alignItems: 'center', color: '#94A3B8', flexShrink: 0, marginLeft: '2px' }}>
        <ChevronDownIcon size={14} color="#94A3B8" />
      </div>
    </div>
  );
}

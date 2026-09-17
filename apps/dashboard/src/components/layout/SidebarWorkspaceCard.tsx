import React, { useState } from 'react';
import type { User } from '../../types';
import { ChevronDownIcon } from '../common/Icons';

interface SidebarWorkspaceCardProps {
  user: User | null;
}

const FALLBACK_PALETTES = [
  { bg: '#FFF3E6', text: '#D95D00', border: '#FFDEC0' }, // Orange / Amber
  { bg: '#EAF5EC', text: '#3C7730', border: '#D5E8D3' }, // Vert IKAN
  { bg: '#EFF6FF', text: '#2563EB', border: '#DBEAFE' }, // Bleu
  { bg: '#FDF2F8', text: '#DB2777', border: '#FCE7F3' }, // Rose
  { bg: '#F5F3FF', text: '#7C3AED', border: '#EDE9FE' }, // Violet
];

function getPalette(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % FALLBACK_PALETTES.length;
  return FALLBACK_PALETTES[index];
}

const AdminProfessionalAvatar: React.FC = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block', width: '100%', height: '100%', borderRadius: '12px' }}
  >
    <defs>
      <linearGradient id="avatarBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#EAF5EC" />
        <stop offset="100%" stopColor="#D5EBD7" />
      </linearGradient>
      <linearGradient id="avatarJacketGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#02302D" />
        <stop offset="100%" stopColor="#054743" />
      </linearGradient>
      <linearGradient id="avatarHairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1E293B" />
        <stop offset="100%" stopColor="#0F172A" />
      </linearGradient>
    </defs>

    {/* Background Base with Soft Rounding */}
    <rect width="48" height="48" rx="12" fill="url(#avatarBgGrad)" />

    {/* Ambient Glow */}
    <circle cx="24" cy="20" r="16" fill="#CDECD2" opacity="0.6" />

    {/* Body / Professional Suit Jacket */}
    <path
      d="M10 46C10 38.5 15.5 34 24 34C32.5 34 38 38.5 38 46"
      fill="url(#avatarJacketGrad)"
    />

    {/* Inner Shirt (White) */}
    <path d="M21 34L24 40L27 34" fill="#FFFFFF" />

    {/* Tie / Accent (IKAN Green) */}
    <path d="M23 37L24 44L25 37Z" fill="#75B72A" />

    {/* Neck */}
    <rect x="21" y="27" width="6" height="8" rx="3" fill="#F4C7A5" />

    {/* Head */}
    <ellipse cx="24" cy="21" rx="8" ry="9" fill="#F8D3B4" />

    {/* Ears */}
    <circle cx="15.5" cy="21" r="2" fill="#F4C7A5" />
    <circle cx="32.5" cy="21" r="2" fill="#F4C7A5" />

    {/* Modern Haircut */}
    <path
      d="M16 19C16 13.5 19 11 24 11C29 11 32 13.5 32 18C30.5 17 28 16.5 24 16.5C19.5 16.5 17.5 17.5 16 19Z"
      fill="url(#avatarHairGrad)"
    />
    <path
      d="M16 19C15.5 21.5 16 23 16.5 24C17 22 17 20 17 19H16Z"
      fill="url(#avatarHairGrad)"
    />
    <path
      d="M32 18C32.5 20.5 32 22 31.5 23C31 21 31 19 31 18H32Z"
      fill="url(#avatarHairGrad)"
    />

    {/* Minimalist Modern Glasses */}
    <rect x="18" y="19" width="5" height="3.5" rx="1" stroke="#02302D" strokeWidth="1" fill="none" />
    <rect x="25" y="19" width="5" height="3.5" rx="1" stroke="#02302D" strokeWidth="1" fill="none" />
    <line x1="23" y1="20.5" x2="25" y2="20.5" stroke="#02302D" strokeWidth="1" />

    {/* Friendly Smile */}
    <path d="M22.5 26C23.2 26.8 24.8 26.8 25.5 26" stroke="#C28260" strokeWidth="1" strokeLinecap="round" />

    {/* Subtle Online / Pro Badge on Avatar Corner */}
    <circle cx="39" cy="9" r="4" fill="#FFFFFF" />
    <circle cx="39" cy="9" r="3" fill="#75B72A" />
  </svg>
);

export default function SidebarWorkspaceCard({ user }: SidebarWorkspaceCardProps) {
  const [imgError, setImgError] = useState(false);

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const orgName = isAdmin ? 'IKAN AI' : (user.organisation_nom || 'Organisation');
  const orgLogo = (!isAdmin && !imgError && user.organisation_logo) ? user.organisation_logo : null;

  // Calcul du sous-titre de l'espace
  let spaceSub = 'Espace de Travail';
  if (isAdmin) {
    spaceSub = 'Espace Administration';
  } else if (user.role === 'cx_manager') {
    spaceSub = 'Espace Siège & Réseau';
  } else if (user.role === 'agency_manager') {
    if (user.agence_nom) {
      const cleanAgence = user.agence_nom.trim();
      spaceSub = cleanAgence.toLowerCase().startsWith('agence')
        ? cleanAgence
        : `Agence ${cleanAgence}`;
    } else {
      spaceSub = 'Espace Agence';
    }
  }

  const palette = getPalette(orgName);
  const initial = orgName.trim().charAt(0).toUpperCase() || 'O';

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: '16px',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#D1D5DB')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#E5E7EB')}
      title={`${orgName} — ${spaceSub}`}
    >
      {/* Logo ou Avatar */}
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          background: isAdmin ? 'transparent' : (orgLogo ? '#FFFFFF' : palette.bg),
          border: isAdmin ? 'none' : `1px solid ${orgLogo ? '#E5E7EB' : palette.border}`,
          color: isAdmin ? '#FFFFFF' : palette.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.88rem',
          fontWeight: 800,
          flexShrink: 0,
          overflow: 'hidden',
          padding: 0,
          boxSizing: 'border-box',
        }}
      >
        {isAdmin ? (
          <AdminProfessionalAvatar />
        ) : orgLogo ? (
          <img
            src={orgLogo}
            alt={orgName}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              padding: '3px',
            }}
          />
        ) : (
          initial
        )}
      </div>

      {/* Titre & Sous-titre */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.88rem',
            color: '#111827',
            fontWeight: 700,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {orgName}
        </div>
        <div
          style={{
            fontSize: '0.72rem',
            color: '#64748B',
            fontWeight: 500,
            lineHeight: 1.2,
            marginTop: '2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {spaceSub}
        </div>
      </div>

      <ChevronDownIcon size={16} color="#9CA3AF" />
    </div>
  );
}

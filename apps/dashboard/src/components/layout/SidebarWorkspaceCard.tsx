import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../../types';
import { ChevronDownIcon, ChevronRightIcon } from '../common/Icons';

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
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const [contextHovered, setContextHovered] = useState(false);
  const [contextFocused, setContextFocused] = useState(false);
  const logoUrl = user?.organisation_logo;
  useEffect(() => setImgError(false), [logoUrl]);

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  // Seul l'Agency Manager a une page "Mon agence" pertinente sans paramètre (/mon-agence
  // résout sur user.agence_id) : pour le CX Manager ou l'Admin, la carte reste informative.
  const isAgencyManager = user.role === 'agency_manager';
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

  if (isAgencyManager) {
    const tooltipId = 'agency-context-tooltip';
    const tooltipVisible = contextHovered || contextFocused;

    return (
      <div className="agency-context-wrap">
        <button
          type="button"
          className="agency-context-button"
          aria-label={`Contexte actuel : ${orgName}, ${spaceSub}. Ouvrir Mon agence.`}
          aria-describedby={tooltipVisible ? tooltipId : undefined}
          onClick={() => navigate('/mon-agence')}
          onMouseEnter={() => setContextHovered(true)}
          onMouseLeave={() => setContextHovered(false)}
          onFocus={() => setContextFocused(true)}
          onBlur={() => setContextFocused(false)}
        >
          <span className="agency-context-logo">
            {orgLogo ? (
              <img src={orgLogo} alt="" onError={() => setImgError(true)} />
            ) : (
              <span aria-hidden="true">{initial}</span>
            )}
          </span>
          <span className="agency-context-chevron" aria-hidden="true">
            <ChevronRightIcon size={16} />
          </span>
        </button>

        {tooltipVisible && (
          <div className="agency-context-tooltip" id={tooltipId} role="tooltip">
            <span className="agency-context-tooltip-org">{orgName}</span>
            <span className="agency-context-tooltip-agency">{spaceSub}</span>
          </div>
        )}

        <style>{`
          .agency-context-wrap {
            position: relative;
            margin-bottom: 24px;
            z-index: 2;
          }
          .agency-context-button {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 68px;
            padding: 9px 36px;
            color: #FFFFFF;
            background: rgba(255, 255, 255, 0.055);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px;
            cursor: pointer;
            transition: background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
          }
          .agency-context-button:hover {
            background: rgba(255, 255, 255, 0.11);
            border-color: rgba(188, 207, 0, 0.42);
            box-shadow: 0 5px 16px rgba(0, 0, 0, 0.16);
          }
          .agency-context-button:focus-visible {
            outline: 3px solid #BCCF00;
            outline-offset: 3px;
          }
          .agency-context-logo {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 46px;
            height: 46px;
            padding: 4px;
            box-sizing: border-box;
            overflow: hidden;
            color: ${palette.text};
            background: ${orgLogo ? '#FFFFFF' : palette.bg};
            border: 1px solid ${orgLogo ? '#E5E7EB' : palette.border};
            border-radius: 12px;
            font-size: 0.95rem;
            font-weight: 800;
          }
          .agency-context-logo img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          .agency-context-chevron {
            position: absolute;
            right: 12px;
            display: flex;
            align-items: center;
            color: rgba(255, 255, 255, 0.48);
            transition: color 180ms ease, transform 180ms ease;
          }
          .agency-context-button:hover .agency-context-chevron,
          .agency-context-button:focus-visible .agency-context-chevron {
            color: #BCCF00;
            transform: translateX(2px);
          }
          .agency-context-tooltip {
            position: absolute;
            top: calc(100% + 8px);
            left: 0;
            z-index: 40;
            display: flex;
            flex-direction: column;
            gap: 3px;
            width: 100%;
            padding: 11px 13px;
            box-sizing: border-box;
            color: #FFFFFF;
            background: #064E3B;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
            pointer-events: none;
          }
          .agency-context-tooltip-org {
            font-size: 0.78rem;
            font-weight: 700;
            line-height: 1.35;
          }
          .agency-context-tooltip-agency {
            color: #C4D5D0;
            font-size: 0.72rem;
            font-weight: 500;
            line-height: 1.4;
            overflow-wrap: anywhere;
          }
          @media (prefers-reduced-motion: reduce) {
            .agency-context-button,
            .agency-context-chevron {
              transition: none;
            }
          }
        `}</style>
      </div>
    );
  }

  // Cliquable uniquement pour l'Agency Manager (vers /mon-agence) ; pour les autres rôles,
  // reste une carte purement informative — aucun comportement de bouton, texte toujours
  // affiché en entier.
  return (
    <div
      onClick={isAgencyManager ? () => navigate('/mon-agence') : undefined}
      role={isAgencyManager ? 'button' : undefined}
      tabIndex={isAgencyManager ? 0 : undefined}
      onKeyDown={
        isAgencyManager
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') navigate('/mon-agence');
            }
          : undefined
      }
      style={{
        background: '#FFFFFF',
        border: '1px solid #EEF0F2',
        borderRadius: '16px',
        padding: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '24px',
        cursor: isAgencyManager ? 'pointer' : 'default',
        userSelect: 'none',
        boxShadow: '0 2px 8px rgba(2, 48, 45, 0.10)',
      }}
    >
      {/* Logo ou Avatar */}
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '12px',
          background: isAdmin ? 'transparent' : (orgLogo ? '#FFFFFF' : palette.bg),
          border: isAdmin ? 'none' : `1px solid ${orgLogo ? '#E5E7EB' : palette.border}`,
          color: isAdmin ? '#FFFFFF' : palette.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.95rem',
          fontWeight: 800,
          flexShrink: 0,
          overflow: 'hidden',
          padding: orgLogo ? '6px' : 0,
          boxSizing: 'border-box',
        }}
      >
        {isAdmin ? (
          <AdminProfessionalAvatar />
        ) : orgLogo ? (
          <img
            src={orgLogo}
            alt=""
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          initial
        )}
      </div>

      {/* Titre & Sous-titre : retour à la ligne libre, la carte grandit en hauteur */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.88rem',
            color: '#111827',
            fontWeight: 700,
            lineHeight: 1.3,
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
          }}
        >
          {orgName}
        </div>
        <div
          style={{
            fontSize: '0.74rem',
            color: '#64748B',
            fontWeight: 500,
            lineHeight: 1.3,
            marginTop: '2px',
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
          }}
        >
          {spaceSub}
        </div>
      </div>

      {/* Chevron décoratif (indique le clic possible pour l'Agency Manager, voir commentaire ci-dessus). */}
      <span style={{ display: 'flex', alignItems: 'center', color: '#94A3B8', flexShrink: 0 }} aria-hidden="true">
        <ChevronDownIcon size={16} />
      </span>
    </div>
  );
}

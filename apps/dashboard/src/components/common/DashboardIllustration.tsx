import React from 'react';

interface DashboardIllustrationProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

export default function DashboardIllustration({
  width = 240,
  height = 160,
  className,
}: DashboardIllustrationProps) {
  return (
    <div
      className={className}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      <svg
        viewBox="0 0 280 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      >
        <defs>
          <linearGradient id="illGradBase" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#EAF5EC" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#D5EBD7" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="illGradScreen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#02302D" />
            <stop offset="100%" stopColor="#054743" />
          </linearGradient>
          <linearGradient id="illGradAccent" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#75B72A" />
            <stop offset="100%" stopColor="#3C7730" />
          </linearGradient>
          <linearGradient id="illGradCard" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F8FAFC" />
          </linearGradient>
          <filter id="illShadow" x="-10%" y="-10%" width="130%" height="130%" filterUnits="userSpaceOnUse">
            <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#02302D" floodOpacity="0.08" />
          </filter>
        </defs>

        {/* Ambient Glow Background Circles */}
        <circle cx="140" cy="95" r="75" fill="url(#illGradBase)" opacity="0.6" />
        <circle cx="210" cy="50" r="35" fill="#E2F2E5" opacity="0.7" />

        {/* Floating SaaS Metric Card (Top Right) */}
        <g filter="url(#illShadow)">
          <rect x="175" y="16" width="95" height="42" rx="10" fill="url(#illGradCard)" stroke="#DCE8DF" strokeWidth="1" />
          <circle cx="190" cy="37" r="6" fill="#EBF5E9" />
          <path d="M188 37L190 39L193 35" stroke="#3C7730" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="202" y="28" width="55" height="5" rx="2.5" fill="#02302D" />
          <rect x="202" y="38" width="35" height="4" rx="2" fill="#75B72A" />
        </g>

        {/* Floating Mini Trend Card (Left) */}
        <g filter="url(#illShadow)">
          <rect x="10" y="45" width="85" height="38" rx="8" fill="url(#illGradCard)" stroke="#DCE8DF" strokeWidth="1" />
          <circle cx="25" cy="64" r="5" fill="#EAF5EC" />
          <path d="M36 67L44 60L52 63L62 55" stroke="#75B72A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <rect x="36" y="52" width="28" height="4" rx="2" fill="#64748B" opacity="0.6" />
        </g>

        {/* Desk Line */}
        <path d="M40 148H240" stroke="#CBDCD1" strokeWidth="3" strokeLinecap="round" />

        {/* Person Working */}
        {/* Chair Back */}
        <rect x="105" y="85" width="14" height="48" rx="6" fill="#D2E3D6" />

        {/* Body & Clothes */}
        <ellipse cx="140" cy="116" rx="22" ry="24" fill="#02302D" />
        {/* Collar / Tie detail */}
        <path d="M136 102L140 112L144 102" fill="#75B72A" />

        {/* Head & Hair */}
        <circle cx="140" cy="74" r="14" fill="#F8D3B4" />
        {/* Modern Hair */}
        <path d="M126 72C126 62 133 56 142 56C151 56 155 62 155 69C149 68 143 66 137 70C133 72 130 75 126 72Z" fill="#1E293B" />

        {/* Arm typing */}
        <path d="M125 112C125 112 135 124 152 126" stroke="#02302D" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="154" cy="126" r="4.5" fill="#F8D3B4" />

        {/* Laptop & Screen */}
        <g filter="url(#illShadow)">
          {/* Laptop Base */}
          <path d="M145 138L185 138L182 142L148 142Z" fill="#94A3B8" />
          {/* Screen Body */}
          <rect x="150" y="96" width="38" height="42" rx="4" transform="skewX(-6)" fill="url(#illGradScreen)" stroke="#475569" strokeWidth="1" />
          {/* Screen Glow / Dashboard Content */}
          <rect x="153" y="101" width="30" height="4" rx="1.5" transform="skewX(-6)" fill="#75B72A" />
          <rect x="153" y="108" width="18" height="3" rx="1.5" transform="skewX(-6)" fill="#FFFFFF" opacity="0.8" />
          <rect x="153" y="114" width="26" height="3" rx="1.5" transform="skewX(-6)" fill="#38BDF8" opacity="0.7" />
          <rect x="153" y="120" width="14" height="3" rx="1.5" transform="skewX(-6)" fill="#E2E8F0" opacity="0.6" />
          {/* Glowing dot on laptop */}
          <circle cx="169" cy="130" r="2" fill="#75B72A" />
        </g>

        {/* Modern Sparkles & Particles */}
        <g fill="#75B72A">
          <path d="M78 28L80 34L86 36L80 38L78 44L76 38L70 36L76 34Z" opacity="0.8" />
          <path d="M225 90L226.5 94L230.5 95.5L226.5 97L225 101L223.5 97L219.5 95.5L223.5 94Z" opacity="0.7" />
          <circle cx="98" cy="78" r="2" opacity="0.5" />
          <circle cx="215" cy="135" r="2.5" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}

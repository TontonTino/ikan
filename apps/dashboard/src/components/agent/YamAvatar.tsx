import React from 'react';

/** Avatar de YAM : pastille verte IKAN avec une étincelle (assistant IA). */
export default function YamAvatar({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #3C7730 0%, #75B72A 100%)',
        color: '#FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 2px 6px rgba(60, 119, 48, 0.25)',
      }}
    >
      <svg
        width={Math.round(size * 0.56)}
        height={Math.round(size * 0.56)}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" opacity="0.85" />
      </svg>
    </span>
  );
}

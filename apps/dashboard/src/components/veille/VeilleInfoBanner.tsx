import React from 'react';
import { InfoIcon } from '../common/Icons';

/** Encart d'information toujours visible — carte neutre, icône info, jamais en rouge. */
export default function VeilleInfoBanner() {
  return (
    <div
      className="saas-card"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        background: 'var(--color-info-bg)',
        padding: '16px 20px',
      }}
    >
      <div style={{ color: 'var(--color-info)', flexShrink: 0, marginTop: '2px' }} aria-hidden="true">
        <InfoIcon size={18} />
      </div>
      <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-body)', lineHeight: 1.5 }}>
        Ces données proviennent des réseaux sociaux et restent séparées des indicateurs de satisfaction
        fondés sur les notes. L'analyse automatique est indicative ; l'ironie, les emojis et les langues
        locales peuvent être mal interprétés.
      </p>
    </div>
  );
}

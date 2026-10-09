import React, { useState } from 'react';
import { ThumbsUpIcon, ThumbsDownIcon, SmileyMehIcon, ExternalLinkIcon, ClockIcon, StoreIcon } from '../common/Icons';
import type { VeilleMention } from '../../types';
import { themeLabel } from '../../utils/themeLabels';

const SENTIMENT_META: Record<string, { label: string; badgeClass: string; icon: React.ReactNode }> = {
  positif: { label: 'Positif', badgeClass: 'badge-success', icon: <ThumbsUpIcon size={12} /> },
  neutre: { label: 'Neutre', badgeClass: 'badge-neutral', icon: <SmileyMehIcon size={12} /> },
  negatif: { label: 'Négatif', badgeClass: 'badge-error', icon: <ThumbsDownIcon size={12} /> },
};

function formatDate(iso: string | null): string {
  if (!iso) return 'Date inconnue';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date inconnue';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// N'affiche "Voir la source" que si l'API a conservé un lien : elle ne garde que le permalink
// https réel (facebook.com / fb.com) et met null sinon. Garde https par défense en profondeur.
function estUrlSure(url: string | null): url is string {
  return !!url && url.startsWith('https://');
}

export default function VeilleMentionCard({ mention }: { mention: VeilleMention }) {
  const [expanded, setExpanded] = useState(false);
  const meta = SENTIMENT_META[mention.sentiment] || SENTIMENT_META.neutre;
  const texteLong = mention.texte.length > 220; // approx. 3 lignes à cette taille de police

  return (
    <div className="saas-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <span className={`badge ${meta.badgeClass}`}>
          {meta.icon}
          {meta.label}
        </span>
        <span className="badge badge-neutral" title={mention.theme_confidence == null ? undefined : `Confiance : ${Math.round(mention.theme_confidence * 100)}%`}>
          {themeLabel(mention.theme_principal)}
        </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.76rem', color: 'var(--color-text-muted)', fontWeight: 600, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ClockIcon size={12} /> {formatDate(mention.date_publication)}
          </span>
          <span style={{ textTransform: 'capitalize' }}>{mention.plateforme}</span>
          {mention.agence_nom && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <StoreIcon size={12} /> {mention.agence_nom}
            </span>
          )}
        </div>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: '0.88rem',
          color: 'var(--color-text-body)',
          lineHeight: 1.5,
          ...(expanded
            ? {}
            : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
        }}
      >
        {mention.texte}
      </p>

      {(texteLong || estUrlSure(mention.url_source)) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          {texteLong ? (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="btn-secondary"
              style={{ padding: '4px 12px', fontSize: '0.76rem' }}
            >
              {expanded ? 'Voir moins' : 'Voir plus'}
            </button>
          ) : (
            <span />
          )}
          {estUrlSure(mention.url_source) && (
            <a
              href={mention.url_source}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'none' }}
            >
              Voir la source <ExternalLinkIcon size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

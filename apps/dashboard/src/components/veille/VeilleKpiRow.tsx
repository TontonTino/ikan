import React from 'react';
import KpiCard from '../ui/KpiCard';
import { MegaphoneIcon, ThumbsDownIcon, TagIcon } from '../common/Icons';
import type { VeilleSyntheseResponse } from '../../types';
import { themeLabel } from '../../utils/themeLabels';

function mentionsLabel(count: number): string {
  return `${count} mention${count > 1 ? 's' : ''}`;
}

export default function VeilleKpiRow({ synthese }: { synthese: VeilleSyntheseResponse }) {
  const negatif = synthese.par_sentiment.negatif;
  const themeDominant = [...synthese.par_theme].sort((a, b) => b.count - a.count)[0];
  const echantillonReduit = synthese.total > 0 && synthese.total < 20;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <KpiCard
          compact
          icon={<MegaphoneIcon />}
          label="Mentions"
          value={synthese.total}
          badgeColor="neutral"
          subtitle="sur la période"
        />
        <KpiCard
          compact
          icon={<ThumbsDownIcon />}
          label="Mentions négatives"
          value={`${negatif?.pourcentage ?? 0}%`}
          badgeColor="red"
          subtitle={mentionsLabel(negatif?.count ?? 0)}
        />
        <KpiCard compact icon={<TagIcon />} label="Thème le plus cité"
          value={themeDominant ? themeLabel(themeDominant.theme_principal) : '—'}
          badgeColor="neutral" subtitle={themeDominant ? mentionsLabel(themeDominant.count) : 'Aucune mention'} />
      </div>
      {echantillonReduit && (
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Échantillon réduit ({synthese.total} mentions), à interpréter avec prudence.
        </p>
      )}
    </div>
  );
}

import React from 'react';
import KpiCard from '../ui/KpiCard';
import { MegaphoneIcon, ThumbsUpIcon, ThumbsDownIcon } from '../common/Icons';
import type { VeilleSyntheseResponse } from '../../types';

function mentionsLabel(count: number): string {
  return `${count} mention${count > 1 ? 's' : ''}`;
}

export default function VeilleKpiRow({ synthese }: { synthese: VeilleSyntheseResponse }) {
  const positif = synthese.par_sentiment.positif;
  const negatif = synthese.par_sentiment.negatif;
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
          icon={<ThumbsUpIcon />}
          label="Positif"
          value={`${positif?.pourcentage ?? 0}%`}
          badgeColor="green"
          subtitle={mentionsLabel(positif?.count ?? 0)}
        />
        <KpiCard
          compact
          icon={<ThumbsDownIcon />}
          label="Négatif"
          value={`${negatif?.pourcentage ?? 0}%`}
          badgeColor="red"
          subtitle={mentionsLabel(negatif?.count ?? 0)}
        />
      </div>
      {echantillonReduit && (
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Échantillon réduit ({synthese.total} mentions), à interpréter avec prudence.
        </p>
      )}
    </div>
  );
}

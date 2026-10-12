import React from 'react';
import type { StatsAgenceResponse } from '../../types';
import Alert from '../ui/Alert';
import Button from '../ui/Button';

/**
 * Corps du bloc « Performances clés » de l'aperçu d'agence : chargement, erreur avec réessai ou données.
 * Une erreur n'est jamais présentée comme un chargement qui dure.
 */
export default function PerformancesCles({ stats, erreur, onRetry }: { stats: StatsAgenceResponse | null; erreur: boolean; onRetry: () => void }) {
  if (erreur && !stats) {
    return (
      <Alert
        tone="warning"
        title="Impossible de charger les performances de l’agence."
        action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>}
      />
    );
  }
  if (!stats) {
    return <div role="status" aria-busy="true" style={{ color: '#64748B', fontSize: '0.84rem' }}>Chargement…</div>;
  }
  const positifs = stats.sentiments.find((s) => s.sentiment === 'positif')?.count ?? 0;
  const negatifs = stats.sentiments.find((s) => s.sentiment === 'negatif')?.count ?? 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
      <div style={{ background: '#F8FAF8', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#02302D' }}>{stats.kpis.satisfaction?.valeur ?? '—'}</div>
        <div style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 600, marginTop: '4px' }}>Satisfaction</div>
      </div>
      <div style={{ background: '#EBF6ED', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#3C7730' }}>{positifs}</div>
        <div style={{ fontSize: '0.72rem', color: '#3C7730', fontWeight: 600, marginTop: '4px' }}>Avis positifs</div>
      </div>
      <div style={{ background: '#FEF2F2', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#B91C1C' }}>{negatifs}</div>
        <div style={{ fontSize: '0.72rem', color: '#B91C1C', fontWeight: 600, marginTop: '4px' }}>Avis négatifs</div>
      </div>
    </div>
  );
}

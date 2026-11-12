import React from 'react';
import type { StatsAgenceResponse } from '../../types';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import { formaterValeurApi } from '../../utils/formatNombre';

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
    return <div role="status" aria-busy="true" className="t-2 t-sm">Chargement…</div>;
  }
  const positifs = stats.sentiments.find((s) => s.sentiment === 'positif')?.count ?? 0;
  const negatifs = stats.sentiments.find((s) => s.sentiment === 'negatif')?.count ?? 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
      <div style={{ background: 'var(--color-bg)', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
        <div className="t-xl t-semi t-encre">{formaterValeurApi(stats.kpis.satisfaction?.valeur, stats.kpis.satisfaction?.valeur_num) ?? '—'}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', marginTop: '4px' }}>Satisfaction</div>
      </div>
      <div style={{ background: 'var(--color-bon-fond)', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
        <div className="t-xl t-semi t-bon">{positifs}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)', marginTop: '4px' }}>Avis positifs</div>
      </div>
      <div style={{ background: 'var(--color-critique-fond)', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
        <div className="t-xl t-semi t-critique">{negatifs}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-critique-texte)', fontWeight: 'var(--weight-semibold)', marginTop: '4px' }}>Avis négatifs</div>
      </div>
    </div>
  );
}

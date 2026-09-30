/**
 * Grille des 8 KPI P0 (KPI Engine) — composant autonome : appelle lui-même
 * kpisApi.list(), gère son propre chargement/erreur/vide. Partagé entre l'onglet
 * Issues de Pilotage et la Vue d'ensemble de l'Agency Manager.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { kpisApi } from '../../services/api';
import type { KPIResult } from '../../types';
import KpiCard from '../ui/KpiCard';
import SkeletonBlock from '../ui/SkeletonBlock';
import { StatsErrorState } from '../stats/StatsStates';
import { kpiIconComponent, formatKpiValue, formatKpiSubtitle } from '../../utils/kpiFormat';

export interface KpiCoreGridProps {
  jours: number;
  agenceId?: string | null;
  /** Incrémenter pour forcer un nouveau fetch sans changer jours/agenceId (ex. après une
      action qui modifie les Issues sous-jacentes, côté appelant). */
  refreshToken?: number;
}

export default function KpiCoreGrid({ jours, agenceId, refreshToken }: KpiCoreGridProps) {
  const [kpis, setKpis] = useState<KPIResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchKpis = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = agenceId ? { jours, agence_id: agenceId } : { jours };
      const res = await kpisApi.list(params);
      setKpis(res.data.kpis);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [jours, agenceId]);

  useEffect(() => {
    fetchKpis();
    // refreshToken déclenche volontairement un refetch sans figurer dans fetchKpis lui-même.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKpis, refreshToken]);

  if (error) {
    return <StatsErrorState message="Impossible de charger les indicateurs KPI." onRetry={fetchKpis} />;
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Chargement des indicateurs KPI" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))', gap: '12px' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} height={90} radius="16px" />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))', gap: '12px' }}>
      {kpis.map((k) => {
        const Icon = kpiIconComponent(k.code);
        return (
          <KpiCard
            key={k.code}
            compact
            icon={<Icon size={16} />}
            label={k.label}
            value={formatKpiValue(k)}
            subtitle={formatKpiSubtitle(k, jours)}
          />
        );
      })}
    </div>
  );
}

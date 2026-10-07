/**
 * Grille des KPI (KPI Engine) — composant autonome : appelle lui-même kpisApi.list(),
 * gère son propre chargement/erreur/vide. Utilisé par l'onglet Issues de Pilotage
 * (CX Manager, PilotageIssuesTab.tsx) — seul consommateur actuel malgré ce qu'un ancien
 * commentaire laissait entendre sur une « Vue d'ensemble Agency Manager » (voir le
 * rapport d'audit KPI).
 *
 * Affichage en 3 sections, dans cet ordre : les 8 KPI communs prioritaires, puis les
 * communs opérationnels (section secondaire), puis le pack du secteur de l'organisation
 * s'il en existe un (famille "sectoriel", app/services/kpi/packs.py). Si le secteur n'a
 * pas encore de pack — et n'est pas "autre" — une note discrète l'indique à la place
 * d'une section vide. Avec PACKS vide pour tous les secteurs (comme aujourd'hui), il n'y
 * a jamais de section sectorielle et jamais plus de 14 cartes : aucun changement visible.
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

const GRILLE_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))',
  gap: '12px',
};

function SectionTitre({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '18px 0 8px' }}>
      {children}
    </div>
  );
}

function Grille({ kpis, jours }: { kpis: KPIResult[]; jours: number }) {
  return (
    <div style={GRILLE_STYLE}>
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

export default function KpiCoreGrid({ jours, agenceId, refreshToken }: KpiCoreGridProps) {
  const [kpis, setKpis] = useState<KPIResult[]>([]);
  const [secteurCode, setSecteurCode] = useState<string | null>(null);
  const [packDisponible, setPackDisponible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchKpis = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = agenceId ? { jours, agence_id: agenceId } : { jours };
      const res = await kpisApi.list(params);
      setKpis(res.data.kpis);
      setSecteurCode(res.data.secteur_code ?? null);
      setPackDisponible(Boolean(res.data.pack_disponible));
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
      <div aria-busy="true" aria-label="Chargement des indicateurs KPI" style={GRILLE_STYLE}>
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} height={90} radius="16px" />
        ))}
      </div>
    );
  }

  const prioritaires = kpis.filter((k) => k.famille === 'commun_prioritaire' || !k.famille);
  const operationnels = kpis.filter((k) => k.famille === 'commun_operationnel');
  const sectoriels = kpis.filter((k) => k.famille === 'sectoriel');
  const secteurSansPack = !packDisponible && !!secteurCode && secteurCode !== 'autre';

  return (
    <div>
      <Grille kpis={prioritaires} jours={jours} />

      {operationnels.length > 0 && (
        <>
          <SectionTitre>Indicateurs opérationnels</SectionTitre>
          <Grille kpis={operationnels} jours={jours} />
        </>
      )}

      {sectoriels.length > 0 && (
        <>
          <SectionTitre>Indicateurs de votre secteur</SectionTitre>
          <Grille kpis={sectoriels} jours={jours} />
        </>
      )}

      {secteurSansPack && (
        <div style={{ marginTop: '14px', fontSize: '0.82rem', color: '#94A3B8', fontStyle: 'italic' }}>
          KPIs spécifiques à votre secteur bientôt disponibles.
        </div>
      )}
    </div>
  );
}

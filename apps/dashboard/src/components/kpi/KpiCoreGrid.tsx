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
import React, { useCallback, useEffect, useId, useState } from 'react';
import { kpisApi } from '../../services/api';
import type { KPIResult } from '../../types';
import KpiCard from '../ui/KpiCard';
import SkeletonBlock from '../ui/SkeletonBlock';
import { StatsErrorState } from '../stats/StatsStates';
import Button from '../ui/Button';
import { kpiIconComponent, kpiLibelle, formatKpiValue, formatKpiSubtitle, kpiAide, etatNonRenseigne } from '../../utils/kpiFormat';

export interface KpiCoreGridProps {
  jours: number;
  agenceId?: string | null;
  /** Incrémenter pour forcer un nouveau fetch sans changer jours/agenceId (ex. après une
      action qui modifie les Issues sous-jacentes, côté appelant). */
  refreshToken?: number;
  /**
   * « complet » (défaut) : toutes les cartes. « bandeau » : une ligne courte de quelques indicateurs sur les problèmes, et un bouton pour déplier les
   * autres ; c'est ce que l'onglet « Problèmes à traiter » affiche APRÈS la liste.
   */
  mode?: 'complet' | 'bandeau';
}

/** Indicateurs du bandeau court (problèmes), dans cet ordre. */
export const CODES_BANDEAU = ['ISSUE_VOLUME', 'CRITICAL_ISSUE_RATE', 'ISSUE_RESOLUTION_RATE', 'LOOP_CLOSURE_RATE'] as const;

const GRILLE_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))',
  gap: '12px',
};

function SectionTitre({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-2)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '18px 0 8px' }}>
      {children}
    </div>
  );
}

function Grille({ kpis, jours }: { kpis: KPIResult[]; jours: number }) {
  return (
    <div style={GRILLE_STYLE}>
      {kpis.map((k) => {
        const Icon = kpiIconComponent(k.code);
        const nonRenseigne = etatNonRenseigne(k);
        return (
          <KpiCard
            key={k.code}
            compact
            icon={<Icon size={16} />}
            label={kpiLibelle(k)}
            value={nonRenseigne ? nonRenseigne.valeur : formatKpiValue(k)}
            subtitle={nonRenseigne ? nonRenseigne.sousTitre : formatKpiSubtitle(k, jours)}
            hint={kpiAide(k.code)}
            {...(nonRenseigne ? { tone: 'neutral' as const } : {})}
          />
        );
      })}
    </div>
  );
}

/** Ligne courte d'indicateurs : libellé, valeur, et pour un indicateur non renseigné la phrase qui explique pourquoi. */
export function LigneBandeau({ kpis, jours }: { kpis: KPIResult[]; jours: number }) {
  const choisis = CODES_BANDEAU.map((code) => kpis.find((k) => k.code === code)).filter((k): k is KPIResult => !!k);
  return (
    <ul className="kpi-bandeau__liste">
      {choisis.map((k) => {
        const nonRenseigne = etatNonRenseigne(k);
        return (
          <li key={k.code} className={`kpi-bandeau__item${nonRenseigne ? ' is-non-renseigne' : ''}`}>
            <span className="kpi-bandeau__label">{kpiLibelle(k)}</span>
            <strong className="kpi-bandeau__valeur">{nonRenseigne ? nonRenseigne.valeur : formatKpiValue(k)}</strong>
            <span className="kpi-bandeau__precision">{nonRenseigne ? nonRenseigne.sousTitre : formatKpiSubtitle(k, jours)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function KpiCoreGrid({ jours, agenceId, refreshToken, mode = 'complet' }: KpiCoreGridProps) {
  const [kpis, setKpis] = useState<KPIResult[]>([]);
  const [secteurCode, setSecteurCode] = useState<string | null>(null);
  const [packDisponible, setPackDisponible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deplie, setDeplie] = useState(false);
  const idBandeau = useId();

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
    return <StatsErrorState message="Impossible de charger les indicateurs." onRetry={fetchKpis} />;
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Chargement des indicateurs" style={GRILLE_STYLE}>
        {Array.from({ length: mode === 'bandeau' ? CODES_BANDEAU.length : 8 }).map((_, i) => (
          <SkeletonBlock key={i} height={mode === 'bandeau' ? 64 : 90} radius="16px" />
        ))}
      </div>
    );
  }

  const prioritaires = kpis.filter((k) => k.famille === 'commun_prioritaire' || !k.famille);
  const operationnels = kpis.filter((k) => k.famille === 'commun_operationnel');
  const sectoriels = kpis.filter((k) => k.famille === 'sectoriel');
  const secteurSansPack = !packDisponible && !!secteurCode && secteurCode !== 'autre';

  const grilleComplete = (
    <>
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
        <div style={{ marginTop: '14px', fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', fontStyle: 'italic' }}>
          Les indicateurs propres à votre secteur seront bientôt disponibles.
        </div>
      )}
    </>
  );

  if (mode === 'bandeau') {
    return (
      <section className="kpi-bandeau" aria-labelledby={`${idBandeau}-titre`}>
        <div className="kpi-bandeau__tete">
          <h2 id={`${idBandeau}-titre`} className="kpi-bandeau__titre">Indicateurs</h2>
          <Button size="sm" variant="secondary" aria-expanded={deplie} aria-controls={`${idBandeau}-tout`} onClick={() => setDeplie((v) => !v)}>
            {deplie ? 'Masquer les indicateurs' : `Voir tous les indicateurs (${kpis.length})`}
          </Button>
        </div>
        <LigneBandeau kpis={kpis} jours={jours} />
        {deplie && <div id={`${idBandeau}-tout`} className="kpi-bandeau__tout">{grilleComplete}</div>}
      </section>
    );
  }

  return <div>{grilleComplete}</div>;
}

import React from 'react';
import type { Alerte, AlerteFeedback, Agence, RecommandationOrg } from '../../types';
import RecommandationCard from '../../components/stats/RecommandationCard';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import { AlertTriangleIcon, LightningIcon } from '../../components/common/Icons';

interface Props {
  alertes: Alerte[]; alertesFeedback: AlerteFeedback[]; alertesLoading: boolean; totalAlertes: number;
  isAgencyManager: boolean; recos: RecommandationOrg[]; recosAffichees: RecommandationOrg[]; recosTotal: number;
  recosLoading: boolean; recosLoadingMore: boolean; loadMoreRecos: () => void;
  agencesList: Agence[]; selectedAgenceId: string | null; setSelectedAgenceId: React.Dispatch<React.SetStateAction<string | null>>;
  marquerRecoTraitee: (id: string) => Promise<void>;
}

export default function PilotageAlertesActionsTab(props: Props) {
  const { alertes, alertesFeedback, alertesLoading, totalAlertes, isAgencyManager, recos, recosAffichees,
    recosTotal, recosLoading, recosLoadingMore, loadMoreRecos, agencesList, selectedAgenceId,
    setSelectedAgenceId, marquerRecoTraitee } = props;
  const RAISON_LABELS: Record<string, string> = { negatif: 'N?gatif', suggestion: 'Suggestion', negatif_et_suggestion: 'N?gatif + Suggestion' };
  return (
<div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {/* ── Sous-section : Alertes ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangleIcon size={18} color="#DC2626" />
              <SectionHeading>Alertes réseau ({alertesLoading ? '…' : totalAlertes})</SectionHeading>
            </div>
            {alertesLoading ? (
            <div aria-busy="true" aria-label="Chargement des alertes" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[0, 1].map((i) => (
                <SkeletonBlock key={i} height={84} radius="var(--radius-2xl)" />
              ))}
            </div>
          ) : totalAlertes === 0 ? (
            <div className="saas-card saas-card--success">
              <EmptyState
                illustration="no-alert"
                title="Aucune alerte critique active"
                message={
                  isAgencyManager
                    ? "Votre agence maintient un taux de satisfaction supérieur à son seuil d'alerte."
                    : "Toutes les agences du réseau maintiennent un taux de satisfaction supérieur à leurs seuils d'alerte."
                }
              />
            </div>
          ) : (
            <div className="saas-card saas-card--critical" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {alertes.map((a, i) => (
                <div
                  key={i}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E8ECE6',
                    borderLeft: '6px solid #DC2626',
                    borderRadius: '24px',
                    padding: '22px 26px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <AlertTriangleIcon size={20} color="#DC2626" />
                      <h3 style={{ fontWeight: 800, color: '#02302D', margin: 0, fontSize: '1rem' }}>{a.agence_nom}</h3>
                    </div>
                    <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '4px 12px', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 800 }}>
                      Taux actuel : {a.taux_actuel}% / Seuil {a.seuil}%
                    </span>
                  </div>
                  <p style={{ color: '#64748B', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>{a.message}</p>
                </div>
              ))}
              {alertesFeedback.map((af) => (
                <div
                  key={af.feedback_id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E8ECE6',
                    borderLeft: '6px solid #DC2626',
                    borderRadius: '24px',
                    padding: '22px 26px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <AlertTriangleIcon size={20} color="#DC2626" />
                      <h3 style={{ fontWeight: 800, color: '#02302D', margin: 0, fontSize: '1rem' }}>{af.agence_nom}</h3>
                    </div>
                    <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '4px 12px', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 800 }}>
                      {RAISON_LABELS[af.raison] || af.raison} — Note {af.note}/5
                    </span>
                  </div>
                  <p style={{ color: '#64748B', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>
                    {af.categorie_nom ? `Catégorie « ${af.categorie_nom} » — ` : ''}
                    {af.commentaire || 'Aucun commentaire.'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sous-section : Actions (recommandations IA — réseau pour le CX Manager, agence pour l'Agency Manager) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LightningIcon size={18} color="#75B72A" />
              <SectionHeading>Recommandations IA ({recosLoading ? '…' : recosTotal})</SectionHeading>
            </div>
            {!isAgencyManager && (
              <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
            )}
          </div>

          {recosLoading ? (
            <div aria-busy="true" aria-label="Chargement des recommandations" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[0, 1, 2].map((i) => (
                <SkeletonBlock key={i} height={96} radius="var(--radius-xl)" />
              ))}
            </div>
          ) : recosAffichees.length === 0 ? (
            <div className="saas-card saas-card--success">
              <EmptyState
                illustration="no-alert"
                title="Aucune recommandation en attente"
                message="Sur ce périmètre, toutes les actions suggérées ont été traitées."
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recosAffichees.map((r) => (
                <RecommandationCard key={r.id} recommandation={r} agenceNom={r.agence_nom} onMarquerTraitee={marquerRecoTraitee} />
              ))}
              {recos.length < recosTotal && (
                <button type="button" onClick={loadMoreRecos} disabled={recosLoadingMore} className="btn-secondary" style={{ alignSelf: 'center' }}>
                  {recosLoadingMore ? 'Chargement…' : `Charger plus (${recos.length}/${recosTotal})`}
                </button>
              )}
            </div>
          )}
        </div>
        </div>
  );
}

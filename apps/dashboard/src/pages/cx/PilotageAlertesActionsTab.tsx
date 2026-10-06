import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Alerte, AlerteFeedback, Agence, RecommandationOrg } from '../../types';
import RecommandationCard from '../../components/stats/RecommandationCard';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import { fullDate, relativeTime } from '../../components/ui/format';
import { AlertTriangleIcon, LightningIcon, MessageSquareIcon } from '../../components/common/Icons';
import { raisonLabel, alerteFeedbackAnchor, alerteSeuilAnchor } from '../../components/alerts/alerteLabels';
import { libelleRecommandations } from '../../utils/sourceAnalyse';

interface Props {
  alertes: Alerte[]; alertesFeedback: AlerteFeedback[]; alertesLoading: boolean; totalAlertes: number;
  isAgencyManager: boolean; recos: RecommandationOrg[]; recosAffichees: RecommandationOrg[]; recosTotal: number;
  recosLoading: boolean; recosLoadingMore: boolean; loadMoreRecos: () => void;
  agencesList: Agence[]; selectedAgenceId: string | null; setSelectedAgenceId: React.Dispatch<React.SetStateAction<string | null>>;
  marquerRecoTraitee: (id: string) => Promise<void>;
}

type AlertTypeFilter = 'toutes' | 'seuil' | 'feedback';
const TYPE_LABEL: Record<AlertTypeFilter, string> = { toutes: 'Toutes', seuil: 'Satisfaction', feedback: 'Feedbacks' };

/** Défile jusqu'à l'alerte ciblée par l'URL (#alerte-…), la met en évidence et lui donne le focus. */
function useHashTarget(ready: boolean) {
  const { hash } = useLocation();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    setTarget(id);
    const t = window.setTimeout(() => setTarget(null), 2400);
    return () => window.clearTimeout(t);
  }, [ready, hash]);
  return target;
}

export default function PilotageAlertesActionsTab(props: Props) {
  const { alertes, alertesFeedback, alertesLoading, isAgencyManager, recos, recosAffichees,
    recosTotal, recosLoading, recosLoadingMore, loadMoreRecos, agencesList, selectedAgenceId,
    setSelectedAgenceId, marquerRecoTraitee } = props;
  const [typeFilter, setTypeFilter] = useState<AlertTypeFilter>('toutes');
  const target = useHashTarget(!alertesLoading);

  // Le filtre agence (CX) s'applique aux alertes ET aux recommandations.
  const seuilAffichees = useMemo(
    () => (typeFilter === 'feedback' ? [] : alertes.filter((a) => !selectedAgenceId || a.agence_id === selectedAgenceId)),
    [alertes, selectedAgenceId, typeFilter],
  );
  const feedbackAffichees = useMemo(
    () =>
      typeFilter === 'seuil'
        ? []
        : alertesFeedback
            .filter((a) => !selectedAgenceId || a.agence_id === selectedAgenceId)
            .sort((x, y) => new Date(y.date_soumission).getTime() - new Date(x.date_soumission).getTime()),
    [alertesFeedback, selectedAgenceId, typeFilter],
  );
  const nbAffichees = seuilAffichees.length + feedbackAffichees.length;
  const filtreActif = typeFilter !== 'toutes' || !!selectedAgenceId;
  const resetFiltres = () => {
    setTypeFilter('toutes');
    setSelectedAgenceId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Filtres de la page : type (tous rôles) + agence (CX uniquement) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="ui-segmented" role="group" aria-label="Type d'alerte">
          {(Object.keys(TYPE_LABEL) as AlertTypeFilter[]).map((t) => (
            <button key={t} type="button" className="ui-segmented__item" aria-pressed={typeFilter === t} onClick={() => setTypeFilter(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {!isAgencyManager && <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />}
      </div>

      {/* ── Alertes actives ── */}
      <section aria-labelledby="alertes-actives" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AlertTriangleIcon size={18} color="var(--color-critical-solid)" aria-hidden="true" />
          <SectionHeading id="alertes-actives">Alertes actives ({alertesLoading ? '…' : nbAffichees})</SectionHeading>
        </div>
        {alertesLoading ? (
          <div aria-busy="true" aria-label="Chargement des alertes" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {[0, 1].map((i) => <SkeletonBlock key={i} height={92} radius="var(--radius-xl)" />)}
          </div>
        ) : nbAffichees === 0 ? (
          <Card tone="success" padding="none">
            <EmptyState
              illustration="no-alert"
              title={filtreActif ? 'Aucune alerte pour ces filtres' : 'Aucune alerte active'}
              message={
                filtreActif
                  ? "Élargissez le type ou l'agence pour voir les autres alertes."
                  : isAgencyManager
                    ? "Votre agence maintient un taux de satisfaction supérieur à son seuil d'alerte."
                    : "Toutes les agences du réseau maintiennent un taux de satisfaction supérieur à leurs seuils d'alerte."
              }
              action={filtreActif ? { label: 'Réinitialiser les filtres', onClick: resetFiltres } : undefined}
            />
          </Card>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none' }}>
            {seuilAffichees.map((a) => {
              const id = alerteSeuilAnchor(a.agence_id);
              return (
                <Card as="li" key={id} id={id} tabIndex={-1} padding="sm" tone="critical" className={`ui-alert-item${target === id ? ' is-target' : ''}`}>
                  <div className="ui-item__head">
                    <AlertTriangleIcon size={18} color="var(--color-critical-solid)" aria-hidden="true" />
                    <h3 className="ui-item__title">{a.agence_nom}</h3>
                    <Badge variant="critical" label="Satisfaction sous le seuil" />
                    <span className="ui-item__spacer" />
                    <span className="ui-item__meta">
                      <strong style={{ color: 'var(--color-critical-text)' }}>{a.taux_actuel} %</strong>&nbsp;pour un seuil de {a.seuil} %
                    </span>
                  </div>
                  {a.message && <p className="ui-item__text">{a.message}</p>}
                </Card>
              );
            })}
            {feedbackAffichees.map((af) => {
              const id = alerteFeedbackAnchor(af.feedback_id);
              return (
                <Card as="li" key={id} id={id} tabIndex={-1} padding="sm" tone="warning" className={`ui-alert-item${target === id ? ' is-target' : ''}`}>
                  <div className="ui-item__head">
                    <MessageSquareIcon size={18} color="var(--color-warning-text)" aria-hidden="true" />
                    <h3 className="ui-item__title">{af.agence_nom}</h3>
                    <Badge variant="critical" label={`${raisonLabel(af.raison)} · ${af.note}/5`} />
                    <span className="ui-item__spacer" />
                    <time className="ui-item__meta" dateTime={af.date_soumission} title={fullDate(af.date_soumission)}>
                      {relativeTime(af.date_soumission)}
                    </time>
                  </div>
                  <p className={`ui-item__text${af.commentaire ? '' : ' ui-item__text--empty'}`}>
                    {af.categorie_nom ? `Catégorie « ${af.categorie_nom} » — ` : ''}
                    {af.commentaire || 'Aucun commentaire.'}
                  </p>
                </Card>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Recommandations (réseau pour le CX Manager, agence pour l'Agency Manager) ── */}
      <section aria-labelledby="alertes-recos" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <LightningIcon size={18} color="var(--color-primary)" aria-hidden="true" />
          <SectionHeading id="alertes-recos">{libelleRecommandations(recos)} ({recosLoading ? '…' : recosTotal})</SectionHeading>
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
      </section>
    </div>
  );
}

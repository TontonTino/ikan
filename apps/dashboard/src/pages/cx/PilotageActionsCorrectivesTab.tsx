import React, { Dispatch, SetStateAction } from 'react';
import type { Agence, Feedback } from '../../types';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import { CheckCircleIcon } from '../../components/common/Icons';
import { extraitCommentaire, formatDate } from './pilotageFormatters';

type Props = {
 isAgencyManager: boolean; agencesList: Agence[]; actionsToggle: 'en_cours' | 'terminees'; setActionsToggle: Dispatch<SetStateAction<'en_cours' | 'terminees'>>;
 actionsEnCours: Feedback[]; actionsTerminees: Feedback[]; actionsEnCoursTotal: number; actionsTermineesTotal: number;
 actionsLoading: boolean; actionsFirstLoadDone: boolean; actionsLoadingMore: boolean; loadMoreActions: () => void;
 actionsAgenceId: string | null; setActionsAgenceId: Dispatch<SetStateAction<string | null>>; marquerActionRealisee: (id: string) => Promise<void>;
};

export default function PilotageActionsCorrectivesTab({ isAgencyManager, agencesList, actionsToggle, setActionsToggle, actionsEnCours, actionsTerminees, actionsEnCoursTotal, actionsTermineesTotal, actionsLoading, actionsFirstLoadDone, actionsLoadingMore, loadMoreActions, actionsAgenceId, setActionsAgenceId, marquerActionRealisee }: Props) {
  const actionsAffichees = actionsToggle === 'en_cours' ? actionsEnCours : actionsTerminees;
  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div
              style={{
                display: 'inline-flex',
                padding: '4px',
                background: '#F8FAFB',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                width: 'fit-content',
              }}
            >
              <button
                type="button"
                onClick={() => setActionsToggle('en_cours')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '9px',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: actionsToggle === 'en_cours' ? '#FEF3C7' : 'transparent',
                  color: actionsToggle === 'en_cours' ? '#B45309' : '#64748B',
                }}
              >
                En cours {actionsFirstLoadDone ? `(${actionsEnCours.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setActionsToggle('terminees')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '9px',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: actionsToggle === 'terminees' ? '#EBF5E9' : 'transparent',
                  color: actionsToggle === 'terminees' ? '#3C7730' : '#64748B',
                }}
              >
                Terminées {actionsFirstLoadDone ? `(${actionsTerminees.length})` : ''}
              </button>
            </div>
            {!isAgencyManager && (
              <AgenceFilterSelect agences={agencesList} selectedId={actionsAgenceId} onChange={setActionsAgenceId} />
            )}
          </div>

          {actionsLoading ? (
            <div aria-busy="true" aria-label="Chargement des actions à mener" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[0, 1, 2].map((i) => (
                <SkeletonBlock key={i} height={90} radius="var(--radius-2xl)" />
              ))}
            </div>
          ) : actionsAffichees.length === 0 ? (
            <div className="saas-card saas-card--success">
              <EmptyState
                illustration="no-alert"
                title={actionsToggle === 'en_cours' ? 'Aucune action en cours' : 'Aucune action terminée pour l’instant'}
                message={
                  actionsToggle === 'en_cours'
                    ? 'Toutes les actions définies ont été confirmées comme réalisées.'
                    : 'Les actions confirmées comme réalisées apparaîtront ici.'
                }
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {actionsAffichees.map((f) => (
                <div
                  key={f.id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E8ECE6',
                    borderLeft: `6px solid ${actionsToggle === 'en_cours' ? '#D97706' : '#3C7730'}`,
                    borderRadius: '24px',
                    padding: '22px 26px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {!isAgencyManager && f.agence_nom && (
                        <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#3C7730', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {f.agence_nom}
                        </span>
                      )}
                      <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5, fontWeight: 500 }}>
                        "{extraitCommentaire(f.commentaire)}"
                      </p>
                    </div>
                    <span
                      style={{
                        background: actionsToggle === 'en_cours' ? '#FEF3C7' : '#EBF5E9',
                        color: actionsToggle === 'en_cours' ? '#B45309' : '#3C7730',
                        padding: '4px 12px',
                        borderRadius: '9999px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {actionsToggle === 'en_cours' ? 'En cours' : 'Terminée'}
                    </span>
                  </div>

                  <div style={{ background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Action à mener
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.86rem', color: '#02302D', fontWeight: 600 }}>
                      {f.action_a_prendre || '—'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.78rem', color: '#64748B', fontWeight: 600 }}>
                    {f.assigne_a_nom && <span>Assigné à : {f.assigne_a_nom}</span>}
                    {formatDate(f.date_assignation) && <span>Assignée le {formatDate(f.date_assignation)}</span>}
                    {actionsToggle === 'terminees' && formatDate(f.date_resolution) && (
                      <span>Résolu le {formatDate(f.date_resolution)}</span>
                    )}
                  </div>

                  {actionsToggle === 'en_cours' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #F1F4EE', paddingTop: '12px' }}>
                      <button
                        type="button"
                        onClick={() => marquerActionRealisee(f.id)}
                        className="btn-primary"
                        style={{ padding: '8px 16px', fontSize: '0.8rem', borderRadius: '10px', fontWeight: 800 }}
                      >
                        <CheckCircleIcon size={15} />
                        Marquer réalisée
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {actionsAffichees.length < (actionsToggle === 'en_cours' ? actionsEnCoursTotal : actionsTermineesTotal) && (
                <button type="button" onClick={loadMoreActions} disabled={actionsLoadingMore} className="btn-secondary" style={{ alignSelf: 'center' }}>
                  {actionsLoadingMore ? 'Chargement…' : `Charger plus (${actionsAffichees.length}/${actionsToggle === 'en_cours' ? actionsEnCoursTotal : actionsTermineesTotal})`}
                </button>
              )}
            </div>
          )}
        </div>
  );
}

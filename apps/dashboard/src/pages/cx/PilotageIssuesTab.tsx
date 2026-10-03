import React from 'react';
import type { Agence, Issue, IssueDetail } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import PeriodSelector from '../../components/stats/PeriodSelector';
import { StatsErrorState } from '../../components/stats/StatsStates';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import Badge from '../../components/ui/Badge';
import IssueDetailModal from '../../components/issues/IssueDetailModal';
import KpiCoreGrid from '../../components/kpi/KpiCoreGrid';
import { ClockIcon } from '../../components/common/Icons';
import { ISSUE_STATUT_LABELS, ISSUE_STATUT_BADGE_VARIANT, ISSUE_SEVERITE_LABELS } from './pilotageConstants';
import { extraitCommentaire, formatDate } from './pilotageFormatters';

interface Props {
  isAgencyManager: boolean; agencesList: Agence[]; issuesJours: number; setIssuesJours: React.Dispatch<React.SetStateAction<number>>;
  issuesAgenceId: string | null; setIssuesAgenceId: React.Dispatch<React.SetStateAction<string | null>>;
  backlogActif: boolean; setBacklogActif: React.Dispatch<React.SetStateAction<boolean>>; issuesKpisRefreshToken: number;
  issuesFirstLoadDone: boolean; issuesAffichees: Issue[]; issuesListRaw: Issue[]; issuesTotal: number;
  ancienneteTexte: string | null; issuesListError: boolean; issuesListLoading: boolean; fetchIssuesList: () => Promise<void>;
  openIssueDetail: (id: string) => Promise<void>; issuesLoadingMore: boolean; loadMoreIssues: () => Promise<void>;
  selectedIssueId: string | null; issueDetail: IssueDetail | null; issueDetailLoading: boolean;
  closeIssueDetail: () => void; terminerActionIssue: (issueId: string, actionId: string) => Promise<void>;
  verifierIssue: (issueId: string) => Promise<void>;
}

export default function PilotageIssuesTab(props: Props) {
  const { isAgencyManager, agencesList, issuesJours, setIssuesJours, issuesAgenceId, setIssuesAgenceId,
    backlogActif, setBacklogActif, issuesKpisRefreshToken, issuesFirstLoadDone, issuesAffichees,
    issuesListRaw, issuesTotal, ancienneteTexte, issuesListError, issuesListLoading, fetchIssuesList,
    openIssueDetail, issuesLoadingMore, loadMoreIssues, selectedIssueId, issueDetail,
    issueDetailLoading, closeIssueDetail, terminerActionIssue, verifierIssue } = props;
  return (
<div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <PeriodSelector
              value={issuesJours}
              onChange={setIssuesJours}
              options={[
                { label: '7 jours', jours: 7 },
                { label: '30 jours', jours: 30 },
                { label: '90 jours', jours: 90 },
              ]}
            />
            {!isAgencyManager && (
              <AgenceFilterSelect agences={agencesList} selectedId={issuesAgenceId} onChange={setIssuesAgenceId} />
            )}
            <button
              type="button"
              onClick={() => setBacklogActif((v) => !v)}
              title="Trie les Issues non closes par ancienneté (les plus anciennes d'abord)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '9999px',
                fontSize: '0.8rem',
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
                border: backlogActif ? '1px solid #3C7730' : '1px solid #E2E8F0',
                background: backlogActif ? '#EBF5E9' : '#FFFFFF',
                color: backlogActif ? '#3C7730' : '#64748B',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <ClockIcon size={14} color={backlogActif ? '#3C7730' : '#64748B'} />
              Vue Backlog
            </button>
          </div>

          {/* KPI P0 */}
          <KpiCoreGrid jours={issuesJours} agenceId={issuesAgenceId} refreshToken={issuesKpisRefreshToken} />

          {/* Liste des Issues */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
              <SectionHeading>Issues ({issuesFirstLoadDone ? `${issuesAffichees.length} affichées · ${issuesListRaw.length}/${issuesTotal} chargées` : '…'})</SectionHeading>
              {ancienneteTexte && (
                <span style={{ fontSize: '0.78rem', color: '#B45309', fontWeight: 700 }}>{ancienneteTexte}</span>
              )}
            </div>

            {issuesListError ? (
              <StatsErrorState message="Impossible de charger la liste des Issues." onRetry={fetchIssuesList} />
            ) : issuesListLoading ? (
              <div aria-busy="true" aria-label="Chargement des Issues" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[0, 1, 2].map((i) => (
                  <SkeletonBlock key={i} height={100} radius="var(--radius-2xl)" />
                ))}
              </div>
            ) : issuesAffichees.length === 0 ? (
              <div className="saas-card saas-card--success">
                <EmptyState
                  illustration="no-alert"
                  title="Aucune Issue sur cette période"
                  message="Aucun problème récurrent n'a été identifié pour les filtres sélectionnés."
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {issuesAffichees.map((issue) => (
                  <div
                    key={issue.id}
                    onClick={() => openIssueDetail(issue.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openIssueDetail(issue.id);
                    }}
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E8ECE6',
                      borderRadius: '24px',
                      padding: '20px 24px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                        {!isAgencyManager && issue.agence_nom && (
                          <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#3C7730', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {issue.agence_nom}
                          </span>
                        )}
                        <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#02302D' }}>{issue.titre}</h3>
                        {issue.description && (
                          <p style={{ margin: 0, fontSize: '0.84rem', color: '#64748B', lineHeight: 1.5 }}>
                            {extraitCommentaire(issue.description, 160)}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
                        <Badge label={ISSUE_SEVERITE_LABELS[issue.severite]} value={issue.severite} />
                        <Badge label={ISSUE_STATUT_LABELS[issue.statut]} variant={ISSUE_STATUT_BADGE_VARIANT[issue.statut]} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.78rem', color: '#64748B', fontWeight: 600, borderTop: '1px solid #F1F4EE', paddingTop: '10px' }}>
                      <span>Détectée le {formatDate(issue.premiere_detection)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!issuesListLoading && !issuesListError && issuesListRaw.length < issuesTotal && (
              <button type="button" onClick={loadMoreIssues} disabled={issuesLoadingMore} className="btn-secondary" style={{ alignSelf: 'center' }}>
                {issuesLoadingMore ? 'Chargement…' : `Charger plus (${issuesListRaw.length}/${issuesTotal})`}
              </button>
            )}
          </div>

          {selectedIssueId && (
            <IssueDetailModal
              issue={issueDetail}
              loading={issueDetailLoading}
              onClose={closeIssueDetail}
              onTerminerAction={terminerActionIssue}
              onVerifier={verifierIssue}
            />
          )}
        </div>
  );
}

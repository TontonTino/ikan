import React, { useMemo, useState } from 'react';
import type { Agence, CriticiteType, Issue, IssueDetail } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import PeriodSelector from '../../components/stats/PeriodSelector';
import { StatsErrorState } from '../../components/stats/StatsStates';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import IssueDetailModal from '../../components/issues/IssueDetailModal';
import KpiCoreGrid from '../../components/kpi/KpiCoreGrid';
import { ClockIcon } from '../../components/common/Icons';
import { ISSUE_STATUT_LABELS, ISSUE_STATUT_BADGE_VARIANT, ISSUE_SEVERITE_LABELS } from './pilotageConstants';
import { extraitCommentaire, formatDate } from './pilotageFormatters';
import {
  GROUPES_STATUT,
  correspondAuGroupe,
  estEnAttente,
  estUrgent,
  etatDelai,
  joursDepuis,
  libelleJours,
  prochainGeste,
  trierParUrgence,
  type GroupeStatut,
} from '../../utils/issueSuivi';

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

const GRAVITES: { id: CriticiteType; label: string }[] = [
  { id: 'critique', label: 'Critique' },
  { id: 'elevee', label: 'Élevée' },
  { id: 'moyenne', label: 'Moyenne' },
  { id: 'faible', label: 'Faible' },
];

export default function PilotageIssuesTab(props: Props) {
  const { isAgencyManager, agencesList, issuesJours, setIssuesJours, issuesAgenceId, setIssuesAgenceId,
    backlogActif, setBacklogActif, issuesKpisRefreshToken, issuesFirstLoadDone, issuesAffichees,
    issuesListRaw, issuesTotal, ancienneteTexte, issuesListError, issuesListLoading, fetchIssuesList,
    openIssueDetail, issuesLoadingMore, loadMoreIssues, selectedIssueId, issueDetail,
    issueDetailLoading, closeIssueDetail, terminerActionIssue, verifierIssue } = props;

  // Filtres de lecture, appliqués côté client aux problèmes déjà chargés.
  const [groupe, setGroupe] = useState<GroupeStatut>('tous');
  const [gravite, setGravite] = useState<CriticiteType | 'toutes'>('toutes');
  const [urgentsDabord, setUrgentsDabord] = useState(false);
  const maintenant = useMemo(() => Date.now(), [issuesAffichees]);

  const compteurs = useMemo(() => {
    const parGravite = issuesAffichees.filter((i) => gravite === 'toutes' || i.severite === gravite);
    return Object.fromEntries(GROUPES_STATUT.map((g) => [g.id, parGravite.filter((i) => correspondAuGroupe(i.statut, g.id)).length])) as Record<GroupeStatut, number>;
  }, [issuesAffichees, gravite]);

  const visibles = useMemo(() => {
    const filtres = issuesAffichees.filter(
      (i) => correspondAuGroupe(i.statut, groupe) && (gravite === 'toutes' || i.severite === gravite),
    );
    return urgentsDabord ? trierParUrgence(filtres, maintenant) : filtres;
  }, [issuesAffichees, groupe, gravite, urgentsDabord, maintenant]);

  const filtreLectureActif = groupe !== 'tous' || gravite !== 'toutes';
  const reinitialiserLecture = () => {
    setGroupe('tous');
    setGravite('toutes');
  };
  const partiel = issuesListRaw.length < issuesTotal;

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
        <Button
          variant={backlogActif ? 'secondary' : 'ghost'}
          icon={<ClockIcon size={14} />}
          aria-pressed={backlogActif}
          onClick={() => setBacklogActif((v) => !v)}
          title="Affiche les problèmes pas encore résolus, du plus ancien au plus récent"
        >
          Problèmes en attente
        </Button>
      </div>

      {/* Indicateurs */}
      <KpiCoreGrid jours={issuesJours} agenceId={issuesAgenceId} refreshToken={issuesKpisRefreshToken} />

      {/* Liste des problèmes */}
      <section aria-labelledby="issues-liste" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
          <SectionHeading id="issues-liste">
            Problèmes à traiter ({issuesFirstLoadDone && !issuesListError ? visibles.length : '…'})
          </SectionHeading>
          {ancienneteTexte && (
            <span style={{ fontSize: '0.78rem', color: 'var(--color-warning-text)', fontWeight: 700 }}>{ancienneteTexte}</span>
          )}
        </div>

        {!issuesListError && issuesFirstLoadDone && issuesAffichees.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div className="ui-segmented" role="group" aria-label="Statut des problèmes">
              {GROUPES_STATUT.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="ui-segmented__item"
                  aria-pressed={groupe === g.id}
                  onClick={() => setGroupe(g.id)}
                  style={{ minHeight: 44 }}
                >
                  {g.label} ({compteurs[g.id]})
                </button>
              ))}
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
              Gravité
              <select
                value={gravite}
                onChange={(e) => setGravite(e.target.value as CriticiteType | 'toutes')}
                style={{ minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontFamily: 'inherit', fontWeight: 600 }}
              >
                <option value="toutes">Toutes</option>
                {GRAVITES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>
            <Button
              variant={urgentsDabord ? 'secondary' : 'ghost'}
              aria-pressed={urgentsDabord}
              onClick={() => setUrgentsDabord((v) => !v)}
              title="Trie d’abord les délais dépassés, puis les gravités les plus élevées, puis les rouverts, du plus ancien au plus récent"
            >
              Urgents d’abord
            </Button>
            {filtreLectureActif && <Button variant="ghost" onClick={reinitialiserLecture}>Effacer les filtres</Button>}
          </div>
        )}
        {!issuesListError && issuesFirstLoadDone && partiel && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            {issuesListRaw.length} problèmes chargés sur {issuesTotal}. Les filtres s’appliquent aux problèmes chargés ; chargez la suite pour voir les autres.
          </p>
        )}

        {issuesListError ? (
          <StatsErrorState message="Impossible de charger la liste des problèmes." onRetry={fetchIssuesList} />
        ) : issuesListLoading ? (
          <div aria-busy="true" aria-label="Chargement des problèmes" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} height={100} radius="var(--radius-2xl)" />
            ))}
          </div>
        ) : issuesAffichees.length === 0 ? (
          <Card tone="success" padding="none">
            <EmptyState
              illustration="no-alert"
              title="Aucun problème sur cette période"
              message="Aucun problème à traiter n’a été enregistré pour les filtres sélectionnés."
            />
          </Card>
        ) : visibles.length === 0 ? (
          <Card padding="none">
            <EmptyState
              illustration="no-alert"
              title="Aucun problème ne correspond à ces filtres"
              message="Élargissez le statut ou la gravité pour voir les autres problèmes."
              action={{ label: 'Effacer les filtres', onClick: reinitialiserLecture }}
            />
          </Card>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: '14px', margin: 0, padding: 0, listStyle: 'none' }}>
            {visibles.map((issue) => {
              const urgent = estUrgent(issue, maintenant);
              const delai = etatDelai(issue, maintenant);
              const age = joursDepuis(issue.premiere_detection, maintenant);
              return (
                // <li> neutre : le rôle « bouton » de la carte cliquable ne doit pas remplacer le rôle « listitem ».
                <li key={issue.id} style={{ listStyle: 'none' }}>
                <Card
                  padding="sm"
                  tone={urgent ? 'critical' : 'default'}
                  onClick={() => openIssueDetail(issue.id)}
                  aria-label={`Ouvrir le problème : ${issue.titre}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: '1 1 260px' }}>
                      {!isAgencyManager && issue.agence_nom && (
                        <span style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {issue.agence_nom}
                        </span>
                      )}
                      <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--color-text-main)' }}>{issue.titre}</h3>
                      {issue.description && (
                        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                          {extraitCommentaire(issue.description, 160)}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
                      <Badge label={ISSUE_SEVERITE_LABELS[issue.severite]} value={issue.severite} />
                      <Badge label={ISSUE_STATUT_LABELS[issue.statut]} variant={ISSUE_STATUT_BADGE_VARIANT[issue.statut]} />
                    </div>
                  </div>

                  <div className="ui-item__meta" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '10px' }}>
                    <span>
                      {estEnAttente(issue.statut)
                        ? `Enregistré il y a ${libelleJours(age)}`
                        : `Enregistré le ${formatDate(issue.premiere_detection)}`}
                    </span>
                    {delai && (
                      <>
                        <span className="ui-item__meta-sep" aria-hidden="true" />
                        <span style={{ color: delai.etat === 'depasse' ? 'var(--color-critical-text)' : undefined, fontWeight: delai.etat === 'depasse' ? 800 : undefined }}>
                          {delai.etat === 'depasse'
                            ? `Délai dépassé${delai.jours > 0 ? ` depuis ${libelleJours(delai.jours)}` : ' aujourd’hui'}`
                            : `À traiter avant le ${formatDate(delai.date)}`}
                        </span>
                      </>
                    )}
                    <span className="ui-item__spacer" />
                    <strong style={{ color: 'var(--color-text-main)' }}>{prochainGeste(issue.statut)}</strong>
                  </div>
                </Card>
                </li>
              );
            })}
          </ul>
        )}
        {!issuesListLoading && !issuesListError && partiel && (
          <Button variant="secondary" onClick={loadMoreIssues} loading={issuesLoadingMore} style={{ alignSelf: 'center' }}>
            {issuesLoadingMore ? 'Chargement…' : `Charger plus (${issuesListRaw.length}/${issuesTotal})`}
          </Button>
        )}
      </section>

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

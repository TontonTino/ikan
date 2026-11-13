import React, { useEffect, useMemo, useRef } from 'react';
import type { Agence, Issue, IssueDetail } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import PeriodSelector from '../../components/stats/PeriodSelector';
import { StatsErrorState } from '../../components/stats/StatsStates';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import PanneauProbleme from '../../components/issues/PanneauProbleme';
import ProblemesFiltres from '../../components/issues/ProblemesFiltres';
import { ProblemesCartes, ProblemesTableau, idLigneProbleme } from '../../components/issues/ProblemesTableau';
import KpiCoreGrid from '../../components/kpi/KpiCoreGrid';
import { useMediaQuery } from '../../components/ui/useMediaQuery';
import { aDesFiltresActifs, annonceListe, FILTRES_PAR_DEFAUT, type FiltresProblemes } from '../../utils/problemesListe';

/** Liste en tableau à partir de cette largeur ; en dessous, des cartes. */
export const REQUETE_TABLEAU = '(min-width: 1024px)';
/** Le panneau se pose À CÔTÉ de la liste à partir de cette largeur (sinon : vue plein écran avec retour). Plus étroit, le tableau n'aurait plus la place de ses colonnes. */
export const REQUETE_PANNEAU_ANCRE = '(min-width: 1360px)';

interface Props {
  isAgencyManager: boolean; agencesList: Agence[]; issuesJours: number; setIssuesJours: React.Dispatch<React.SetStateAction<number>>;
  issuesAgenceId: string | null; setIssuesAgenceId: React.Dispatch<React.SetStateAction<string | null>>;
  /** Filtres de la liste (serveur). L'agence est choisie à part, en tête de page. */
  filtres: FiltresProblemes; setFiltres: (suite: Partial<FiltresProblemes>) => void;
  issuesKpisRefreshToken: number;
  issuesFirstLoadDone: boolean; issuesListRaw: Issue[]; issuesTotal: number;
  issuesListError: boolean; issuesListLoading: boolean; fetchIssuesList: () => Promise<void>;
  openIssueDetail: (id: string) => Promise<void>; issuesLoadingMore: boolean; loadMoreIssues: () => Promise<void>;
  selectedIssueId: string | null; issueDetail: IssueDetail | null; issueDetailLoading: boolean;
  closeIssueDetail: () => void; apresActionIssue: (issueId: string, message: string) => Promise<void>;
  verifierIssue: (issueId: string) => Promise<void>;
}

export default function PilotageIssuesTab(props: Props) {
  const { isAgencyManager, agencesList, issuesJours, setIssuesJours, issuesAgenceId, setIssuesAgenceId, filtres, setFiltres,
    issuesKpisRefreshToken, issuesFirstLoadDone, issuesListRaw, issuesTotal, issuesListError, issuesListLoading, fetchIssuesList,
    openIssueDetail, issuesLoadingMore, loadMoreIssues, selectedIssueId, issueDetail,
    issueDetailLoading, closeIssueDetail, apresActionIssue, verifierIssue } = props;

  const enTableau = useMediaQuery(REQUETE_TABLEAU);
  const panneauAncre = useMediaQuery(REQUETE_PANNEAU_ANCRE);
  const maintenant = useMemo(() => Date.now(), [issuesListRaw]);
  const filtresActifs = aDesFiltresActifs(filtres);
  const partiel = issuesListRaw.length < issuesTotal;
  const ligneOuverte = issuesListRaw.find((i) => i.id === selectedIssueId) ?? null;

  const ouvrir = (issue: Issue) => { void openIssueDetail(issue.id); };
  // Fermer rend le focus à la ligne d'où l'on venait (le panneau plein écran le fait déjà seul, par son piège de focus).
  const ancienne = useRef<string | null>(null);
  const fermer = () => {
    ancienne.current = selectedIssueId;
    closeIssueDetail();
  };
  useEffect(() => {
    if (selectedIssueId === null && ancienne.current) {
      document.getElementById(idLigneProbleme(ancienne.current))?.focus();
      ancienne.current = null;
    }
  }, [selectedIssueId]);

  const Liste = enTableau ? ProblemesTableau : ProblemesCartes;
  const ouvert = selectedIssueId !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {!isAgencyManager && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <AgenceFilterSelect agences={agencesList} selectedId={issuesAgenceId} onChange={setIssuesAgenceId} />
        </div>
      )}

      <div className={`pb-mise-en-page${ouvert && panneauAncre ? ' pb-mise-en-page--panneau' : ''}`}>
        {/* Liste des problèmes : d'abord (le travail), les indicateurs ensuite en bandeau court */}
        <section aria-labelledby="issues-liste" className="pb-liste">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
            <SectionHeading id="issues-liste">
              Problèmes à traiter ({issuesFirstLoadDone && !issuesListError ? issuesTotal : '…'})
            </SectionHeading>
          </div>
          <p role="status" className="ui-sr-only">
            {issuesFirstLoadDone && !issuesListError && !issuesListLoading ? annonceListe(issuesListRaw.length, issuesTotal, filtresActifs) : ''}
          </p>

          {!issuesListError && issuesFirstLoadDone && (issuesListRaw.length > 0 || filtresActifs) && (
            <ProblemesFiltres filtres={filtres} onChange={setFiltres} />
          )}
          {!issuesListError && issuesFirstLoadDone && partiel && (
            <p className="pb-note">{issuesListRaw.length} problèmes chargés sur {issuesTotal}. Les filtres portent sur l’ensemble des problèmes.</p>
          )}

          {issuesListError ? (
            <StatsErrorState message="Impossible de charger la liste des problèmes. Cela ne signifie pas qu’il n’y en a pas." onRetry={fetchIssuesList} />
          ) : issuesListLoading ? (
            <div aria-busy="true" aria-label="Chargement des problèmes" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[0, 1, 2, 3].map((i) => (
                <SkeletonBlock key={i} height={enTableau ? 56 : 96} radius="var(--radius-xl)" />
              ))}
            </div>
          ) : issuesListRaw.length === 0 ? (
            filtresActifs ? (
              <Card padding="none">
                <EmptyState
                  illustration="no-alert"
                  title="Aucun problème pour ces filtres"
                  message="Élargissez l’état ou la gravité, ou retirez « En retard », pour voir les autres problèmes."
                  action={{ label: 'Effacer les filtres', onClick: () => setFiltres({ statut: FILTRES_PAR_DEFAUT.statut, gravite: FILTRES_PAR_DEFAUT.gravite, enRetard: FILTRES_PAR_DEFAUT.enRetard }) }}
                />
              </Card>
            ) : (
              <Card tone="success" padding="none">
                <EmptyState
                  illustration="no-alert"
                  title="Aucun problème suivi"
                  message="Quand plusieurs avis parlent de la même chose, créez un problème depuis la fiche d’un avis."
                />
              </Card>
            )
          ) : (
            <Liste issues={issuesListRaw} afficherAgence={!isAgencyManager} ouvertId={selectedIssueId} onOuvrir={ouvrir} maintenant={maintenant} />
          )}
          {!issuesListLoading && !issuesListError && partiel && (
            <Button variant="secondary" onClick={loadMoreIssues} loading={issuesLoadingMore} style={{ alignSelf: 'center' }}>
              {issuesLoadingMore ? 'Chargement…' : `Charger plus (${issuesListRaw.length}/${issuesTotal})`}
            </Button>
          )}
        </section>

        {ouvert && (
          <PanneauProbleme
            issue={issueDetail}
            loading={issueDetailLoading}
            titreProvisoire={ligneOuverte?.titre}
            agenceProvisoire={ligneOuverte?.agence_nom}
            mode={panneauAncre ? 'ancre' : 'plein'}
            onClose={fermer}
            onActionsChange={apresActionIssue}
            onVerifier={verifierIssue}
            onOuvrirOrigine={(id) => { void openIssueDetail(id); }}
          />
        )}
      </div>

      {/* Indicateurs : bandeau court sous la liste ; « Non renseigné » plutôt qu'un chiffre trompeur quand la donnée manque */}
      <div className="pb-indicateurs-tete">
        <span>Indicateurs de la période</span>
        <PeriodSelector value={issuesJours} onChange={setIssuesJours} />
      </div>
      <KpiCoreGrid mode="bandeau" jours={issuesJours} agenceId={issuesAgenceId} refreshToken={issuesKpisRefreshToken} />
    </div>
  );
}

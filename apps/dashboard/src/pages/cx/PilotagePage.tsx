import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { agencesApi, feedbacksApi, issuesApi } from '../../services/api';
import PilotageIssuesTab from './PilotageIssuesTab';
import SuggestionsView from './SuggestionsView';
import PilotageActionsTab from './PilotageActionsTab';
import { useActionsUnifiees } from './useActionsUnifiees';
import { FILTRES_ACTIONS_PAR_DEFAUT, type FiltresActions } from '../../utils/actionsUnifiees';
import AlertesView from './AlertesView';
import type { Agence, Issue, IssueDetail } from '../../types';
import PageTitle from '../../components/ui/PageTitle';
import AideAlertes from '../../components/alerts/AideAlertes';
import { useToast } from '../../components/ui/Toast';
import { userFacingError } from '../../utils/userFacingError';
import { FILTRES_PAR_DEFAUT, parametresListe, type FiltresProblemes } from '../../utils/problemesListe';

/** Une section = une page de la navigation (une destination = une fonction). */
export type PilotageSection = 'alertes' | 'suggestions' | 'actions' | 'issues';

const SECTION_HEADER: Record<PilotageSection, { title: string; cx: string; agency: string }> = {
  alertes: {
    title: 'Alertes',
    cx: 'Agences sous leur seuil de satisfaction et avis à risque du réseau.',
    agency: 'Ce qui demande votre attention dans votre agence : satisfaction sous le seuil et avis à risque.',
  },
  suggestions: {
    title: 'Suggestions',
    cx: 'Idées remontées par les clients de tout le réseau : étudier, décider, suivre.',
    agency: 'Idées remontées par les clients de votre agence : étudier, décider, suivre.',
  },
  actions: {
    title: 'Actions à mener',
    cx: 'Ce qui reste à faire sur vos problèmes et sur vos avis, au même endroit : qui s’en occupe, pour quand, et ce qui est en retard.',
    agency: 'Ce qui reste à faire dans votre agence, sur les problèmes et sur les avis : qui s’en occupe et pour quand.',
  },
  issues: {
    title: 'Problèmes à traiter',
    cx: 'Situations que vos équipes ont décidé de suivre, créées à partir d’un ou plusieurs avis, avec leurs actions et leur vérification.',
    agency: 'Situations suivies dans votre agence, créées à partir d’un ou plusieurs avis, avec leurs actions et leur vérification.',
  },
};

/**
 * Page fusionnée "Pilotage" : regroupe Alertes & Actions (alertes réseau +
 * recommandations IA consolidées, déplacées depuis Statistiques & Analyses)
 * et Boîte à idées en une seule page à 2 onglets, pour le CX Manager (réseau)
 * et l'Agency Manager (limité à sa seule agence — le scoping est fait par l'API).
 */
export default function PilotagePage({ section }: { section: PilotageSection }) {
  const currentUser = useAuthStore((s) => s.user);
  const isAgencyManager = currentUser?.role === 'agency_manager';

  const toastApi = useToast();
  const showToast = (msg: string) => toastApi.show({ message: msg, tone: /erreur|impossible/i.test(msg) ? 'critical' : 'success' });

  // ── Agences (filtre des actions et des problèmes — CX Manager) ──
  const [agencesList, setAgencesList] = useState<Agence[]>([]);

  useEffect(() => {
    // Le filtre par agence n'a de sens que pour le CX Manager (réseau multi-agences).
    // Les alertes et les suggestions chargent leurs propres données (AlertesView, SuggestionsView).
    if (isAgencyManager || section === 'suggestions' || section === 'alertes') return;
    agencesApi
      .list()
      .then((res) => {
        if (Array.isArray(res.data)) setAgencesList(res.data);
      })
      .catch(() => setAgencesList([]));
  }, []);

  // ── Actions à mener : liste unique (actions sur avis + actions de problème), filtres envoyés au serveur ──
  const [filtresActions, setFiltresActions] = useState<FiltresActions>(FILTRES_ACTIONS_PAR_DEFAUT);
  const changerFiltresActions = useCallback((suite: Partial<FiltresActions>) => setFiltresActions((f) => ({ ...f, ...suite })), []);
  const actions = useActionsUnifiees(section === 'actions', filtresActions, currentUser?.id);

  const confirmerAvis = async (feedbackId: string) => {
    try {
      await feedbacksApi.confirmerActionRealisee(feedbackId);
      showToast('Action marquée comme réalisée. L’avis est passé à « Résolu ».');
      await actions.recharger();
    } catch (err) {
      console.error('Erreur confirmation de l’action:', err);
      showToast(userFacingError(err, 'Impossible de confirmer l’action. Veuillez réessayer.'));
    }
  };

  // ── Issues (KPI P0 + liste + détail) ──────────────────
  const [issuesJours, setIssuesJours] = useState(30);
  const [issuesAgenceId, setIssuesAgenceId] = useState<string | null>(null);
  // Filtres de la liste (état, gravité, en retard, tri) : envoyés au serveur, donc vrais sur l'ensemble des problèmes. La période (issuesJours) ne concerne que les indicateurs.
  const [filtresIssues, setFiltresIssues] = useState<FiltresProblemes>(FILTRES_PAR_DEFAUT);
  const changerFiltresIssues = useCallback((suite: Partial<FiltresProblemes>) => setFiltresIssues((f) => ({ ...f, ...suite })), []);

  // KpiCoreGrid gère son propre fetch ; ce compteur ne sert qu'à lui demander de
  // rafraîchir après une action qui modifie les Issues sous-jacentes (terminer/vérifier).
  const [issuesKpisRefreshToken, setIssuesKpisRefreshToken] = useState(0);

  const [issuesListRaw, setIssuesListRaw] = useState<Issue[]>([]);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [issuesLoadingMore, setIssuesLoadingMore] = useState(false);
  const [issuesListLoading, setIssuesListLoading] = useState(true);
  const [issuesListError, setIssuesListError] = useState(false);
  const [issuesFirstLoadDone, setIssuesFirstLoadDone] = useState(false);

  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueDetail, setIssueDetail] = useState<IssueDetail | null>(null);
  const [issueDetailLoading, setIssueDetailLoading] = useState(false);

  const fetchIssuesList = useCallback(async () => {
    setIssuesListLoading(true);
    setIssuesListError(false);
    try {
      const res = await issuesApi.list(parametresListe({ ...filtresIssues, agenceId: issuesAgenceId }));
      setIssuesListRaw(res.data || []);
      setIssuesTotal(Number(res.headers?.['x-total-count'] || 0));
    } catch {
      setIssuesListError(true);
    } finally {
      setIssuesListLoading(false);
      setIssuesFirstLoadDone(true);
    }
  }, [issuesAgenceId, filtresIssues]);

  const loadMoreIssues = async () => {
    if (issuesLoadingMore || issuesListRaw.length >= issuesTotal) return;
    setIssuesLoadingMore(true);
    try {
      const response = await issuesApi.list(parametresListe({ ...filtresIssues, agenceId: issuesAgenceId }, issuesListRaw.length));
      setIssuesListRaw((current) => [...current, ...(response.data || [])]);
    } catch {
      showToast('Impossible de charger les problèmes suivants');
    } finally {
      setIssuesLoadingMore(false);
    }
  };

  useEffect(() => {
    if (section !== 'issues') return;
    fetchIssuesList();
  }, [fetchIssuesList, section]);

  const openIssueDetail = useCallback(async (issueId: string) => {
    setSelectedIssueId(issueId);
    setIssueDetail(null);
    setIssueDetailLoading(true);
    try {
      const res = await issuesApi.get(issueId);
      setIssueDetail(res.data);
    } catch {
      showToast('Impossible de charger le détail de ce problème');
      setSelectedIssueId(null);
    } finally {
      setIssueDetailLoading(false);
    }
  }, []);

  const closeIssueDetail = () => {
    setSelectedIssueId(null);
    setIssueDetail(null);
  };

  const rafraichirApresActionIssue = useCallback(async (issueId: string) => {
    if (section === 'issues') await fetchIssuesList();
    if (section === 'actions') await actions.recharger();
    setIssuesKpisRefreshToken((t) => t + 1);
    if (selectedIssueId !== issueId) return;                    // le détail n'est rechargé que s'il est ouvert
    try {
      const res = await issuesApi.get(issueId);
      setIssueDetail(res.data);
    } catch {
      // Le détail reste tel quel si le refetch échoue ; liste et KPI sont déjà à jour.
    }
  }, [fetchIssuesList, section, actions.recharger, selectedIssueId]);

  // L'appel (créer / terminer une action) est fait par les boîtes de dialogue, qui gèrent leurs erreurs ; la page annonce le résultat et rafraîchit liste, indicateurs et détail.
  const apresActionIssue = async (issueId: string, message: string) => {
    showToast(message);
    await rafraichirApresActionIssue(issueId);
  };

  const verifierIssue = async (issueId: string) => {
    try {
      await issuesApi.verifier(issueId);
      showToast('Résolution du problème vérifiée');
      await rafraichirApresActionIssue(issueId);
    } catch {
      showToast("Impossible d’enregistrer la vérification du problème");
    }
  };

  const header = SECTION_HEADER[section];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <PageTitle title={header.title} description={isAgencyManager ? header.agency : header.cx} meta={section === 'alertes' ? <AideAlertes /> : undefined} />

      {/* ── SECTION ALERTES & ACTIONS (fusion : alertes réseau + recommandations IA) ── */}
      {section === 'alertes' && <AlertesView />}

      {/* ── SECTION BOÎTE À IDÉES ── */}
      {section === 'suggestions' && <SuggestionsView />}



      {/* ── SECTION ACTIONS CORRECTIVES (suivi + confirmation uniquement — la définition d'une action reste dans FeedbackTreatmentModal) ── */}
      {section === 'actions' && <PilotageActionsTab isAgencyManager={isAgencyManager} agencesList={agencesList} filtres={filtresActions} setFiltres={changerFiltresActions} lignes={actions.lignes} total={actions.total} autreTotal={actions.autreTotal} chargement={actions.chargement} premierChargement={actions.premierChargement} erreur={actions.erreur} chargementSuite={actions.chargementSuite} partiel={actions.partiel} recharger={actions.recharger} chargerSuite={async () => { if ((await actions.chargerSuite()) === 'echec') showToast('Impossible de charger les actions suivantes'); }} confirmerAvis={confirmerAvis} apresTerminaison={apresActionIssue} openIssueDetail={openIssueDetail} selectedIssueId={selectedIssueId} issueDetail={issueDetail} issueDetailLoading={issueDetailLoading} closeIssueDetail={closeIssueDetail} apresActionIssue={apresActionIssue} verifierIssue={verifierIssue} />}



      {/* ── SECTION ISSUES (KPI P0 + liste + détail — pas de création ici, voir rapport) ── */}
      {section === 'issues' && <PilotageIssuesTab isAgencyManager={isAgencyManager} agencesList={agencesList} issuesJours={issuesJours} setIssuesJours={setIssuesJours} issuesAgenceId={issuesAgenceId} setIssuesAgenceId={setIssuesAgenceId} filtres={filtresIssues} setFiltres={changerFiltresIssues} issuesKpisRefreshToken={issuesKpisRefreshToken} issuesFirstLoadDone={issuesFirstLoadDone} issuesListRaw={issuesListRaw} issuesTotal={issuesTotal} issuesListError={issuesListError} issuesListLoading={issuesListLoading} fetchIssuesList={fetchIssuesList} openIssueDetail={openIssueDetail} issuesLoadingMore={issuesLoadingMore} loadMoreIssues={loadMoreIssues} selectedIssueId={selectedIssueId} issueDetail={issueDetail} issueDetailLoading={issueDetailLoading} closeIssueDetail={closeIssueDetail} apresActionIssue={apresActionIssue} verifierIssue={verifierIssue} />}
    </div>
  );
}

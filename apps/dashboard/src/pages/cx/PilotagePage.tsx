import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { agencesApi, feedbacksApi, issuesApi } from '../../services/api';
import PilotageIssuesTab from './PilotageIssuesTab';
import SuggestionsView from './SuggestionsView';
import PilotageActionsCorrectivesTab from './PilotageActionsCorrectivesTab';
import AlertesView from './AlertesView';
import type { Agence, Feedback, Issue, IssueDetail } from '../../types';
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
    cx: 'Agences sous leur seuil de satisfaction, avis à risque et recommandations du réseau.',
    agency: 'Ce qui demande votre attention dans votre agence : satisfaction sous le seuil, avis à risque, recommandations.',
  },
  suggestions: {
    title: 'Suggestions',
    cx: 'Idées remontées par les clients de tout le réseau : étudier, décider, suivre.',
    agency: 'Idées remontées par les clients de votre agence : étudier, décider, suivre.',
  },
  actions: {
    title: 'Actions à mener',
    cx: 'Actions décidées sur les avis clients du réseau, en cours ou terminées. Celles d’un problème à traiter se suivent dans son détail.',
    agency: 'Actions décidées sur les avis clients de votre agence, en cours ou terminées. Celles d’un problème à traiter se suivent dans son détail.',
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

  // ── Actions correctives (suivi + confirmation, pas de création ici) ──
  const [actionsToggle, setActionsToggle] = useState<'en_cours' | 'terminees'>('en_cours');
  const [actionsEnCours, setActionsEnCours] = useState<Feedback[]>([]);
  const [actionsTerminees, setActionsTerminees] = useState<Feedback[]>([]);
  const [actionsEnCoursTotal, setActionsEnCoursTotal] = useState(0);
  const [actionsTermineesTotal, setActionsTermineesTotal] = useState(0);
  const [actionsLoadingMore, setActionsLoadingMore] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsFirstLoadDone, setActionsFirstLoadDone] = useState(false);
  const [actionsError, setActionsError] = useState(false);
  const [actionsAgenceId, setActionsAgenceId] = useState<string | null>(null);

  const fetchActions = useCallback(async () => {
    setActionsLoading(true);
    setActionsError(false);
    try {
      const agenceParam = actionsAgenceId ? { agence_id: actionsAgenceId } : {};
      const [enCoursRes, termineesRes] = await Promise.all([
        feedbacksApi.list({ avec_action: true, action_realisee: false, limit: 50, offset: 0, ...agenceParam }),
        feedbacksApi.list({ avec_action: true, action_realisee: true, limit: 50, offset: 0, ...agenceParam }),
      ]);
      setActionsEnCours(enCoursRes?.data || []);
      setActionsTerminees(termineesRes?.data || []);
      setActionsEnCoursTotal(Number(enCoursRes?.headers?.['x-total-count'] || 0));
      setActionsTermineesTotal(Number(termineesRes?.headers?.['x-total-count'] || 0));
    } catch (err) {
      // Un échec de chargement n'est jamais présenté comme « aucune action ».
      console.error('Erreur chargement des actions:', err);
      setActionsEnCours([]);
      setActionsTerminees([]);
      setActionsError(true);
    } finally {
      setActionsLoading(false);
      setActionsFirstLoadDone(true);
    }
  }, [actionsAgenceId]);

  useEffect(() => {
    if (section !== 'actions') return;
    fetchActions();
  }, [fetchActions, section]);

  const loadMoreActions = async () => {
    const current = actionsToggle === 'en_cours' ? actionsEnCours : actionsTerminees;
    const total = actionsToggle === 'en_cours' ? actionsEnCoursTotal : actionsTermineesTotal;
    if (actionsLoadingMore || current.length >= total) return;
    setActionsLoadingMore(true);
    try {
      const res = await feedbacksApi.list({
        avec_action: true,
        action_realisee: actionsToggle === 'terminees',
        limit: 50,
        offset: current.length,
        ...(actionsAgenceId ? { agence_id: actionsAgenceId } : {}),
      });
      if (actionsToggle === 'en_cours') setActionsEnCours((items) => [...items, ...(res.data || [])]);
      else setActionsTerminees((items) => [...items, ...(res.data || [])]);
    } catch {
      showToast('Impossible de charger les actions suivantes');
    } finally {
      setActionsLoadingMore(false);
    }
  };

  const marquerActionRealisee = async (feedbackId: string) => {
    try {
      await feedbacksApi.confirmerActionRealisee(feedbackId);
      setActionsEnCours((prev) => prev.filter((f) => f.id !== feedbackId));
      setActionsEnCoursTotal((total) => Math.max(0, total - 1));
      setActionsTermineesTotal((total) => total + 1);
      showToast('Action marquée comme réalisée. L’avis est passé à « Résolu ».');
      // La liste « Terminées » doit refléter la confirmation : rechargement des listes.
      fetchActions();
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
    await fetchIssuesList();
    setIssuesKpisRefreshToken((t) => t + 1);
    try {
      const res = await issuesApi.get(issueId);
      setIssueDetail(res.data);
    } catch {
      // Le détail reste tel quel si le refetch échoue ; liste et KPI sont déjà à jour.
    }
  }, [fetchIssuesList]);

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
      {section === 'actions' && <PilotageActionsCorrectivesTab isAgencyManager={isAgencyManager} agencesList={agencesList} actionsToggle={actionsToggle} setActionsToggle={setActionsToggle} actionsEnCours={actionsEnCours} actionsTerminees={actionsTerminees} actionsEnCoursTotal={actionsEnCoursTotal} actionsTermineesTotal={actionsTermineesTotal} actionsLoading={actionsLoading} actionsError={actionsError} refetchActions={fetchActions} actionsFirstLoadDone={actionsFirstLoadDone} actionsLoadingMore={actionsLoadingMore} loadMoreActions={loadMoreActions} actionsAgenceId={actionsAgenceId} setActionsAgenceId={setActionsAgenceId} marquerActionRealisee={marquerActionRealisee} />}



      {/* ── SECTION ISSUES (KPI P0 + liste + détail — pas de création ici, voir rapport) ── */}
      {section === 'issues' && <PilotageIssuesTab isAgencyManager={isAgencyManager} agencesList={agencesList} issuesJours={issuesJours} setIssuesJours={setIssuesJours} issuesAgenceId={issuesAgenceId} setIssuesAgenceId={setIssuesAgenceId} filtres={filtresIssues} setFiltres={changerFiltresIssues} issuesKpisRefreshToken={issuesKpisRefreshToken} issuesFirstLoadDone={issuesFirstLoadDone} issuesListRaw={issuesListRaw} issuesTotal={issuesTotal} issuesListError={issuesListError} issuesListLoading={issuesListLoading} fetchIssuesList={fetchIssuesList} openIssueDetail={openIssueDetail} issuesLoadingMore={issuesLoadingMore} loadMoreIssues={loadMoreIssues} selectedIssueId={selectedIssueId} issueDetail={issueDetail} issueDetailLoading={issueDetailLoading} closeIssueDetail={closeIssueDetail} apresActionIssue={apresActionIssue} verifierIssue={verifierIssue} />}
    </div>
  );
}

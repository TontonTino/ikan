import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { alertesApi, suggestionsApi, recommandationsApi, agencesApi, feedbacksApi, issuesApi } from '../../services/api';
import PilotageIssuesTab from './PilotageIssuesTab';
import PilotageIdeasTab from './PilotageIdeasTab';
import PilotageActionsCorrectivesTab from './PilotageActionsCorrectivesTab';
import PilotageAlertesActionsTab from './PilotageAlertesActionsTab';
import type { Alerte, AlerteFeedback, Suggestion, IdeaStatus, RecommandationOrg, Agence, Feedback, Issue, IssueDetail } from '../../types';
import { STATUS_LABELS } from './pilotageConstants';
import PageTitle from '../../components/ui/PageTitle';
import { useToast } from '../../components/ui/Toast';

/** Une section = une page de la navigation (une destination = une fonction). */
export type PilotageSection = 'alertes' | 'suggestions' | 'actions' | 'issues';

const SECTION_HEADER: Record<PilotageSection, { title: string; cx: string; agency: string }> = {
  alertes: {
    title: 'Alertes',
    cx: 'Agences sous leur seuil de satisfaction, feedbacks à risque et recommandations IA du réseau : filtrer, analyser, traiter.',
    agency: 'Ce qui demande votre attention dans votre agence : seuil de satisfaction, feedbacks à risque, recommandations IA.',
  },
  suggestions: {
    title: 'Suggestions',
    cx: 'Idées remontées par les clients de tout le réseau : étudier, décider, suivre.',
    agency: 'Idées remontées par les clients de votre agence : étudier, décider, suivre.',
  },
  actions: {
    title: 'Actions correctives',
    cx: 'Suivi des actions décidées dans le réseau, en cours et réalisées.',
    agency: 'Suivi de vos actions, en cours et réalisées.',
  },
  issues: {
    title: 'Issues',
    cx: 'Problèmes récurrents détectés à partir des feedbacks, avec leurs actions et leur vérification.',
    agency: 'Problèmes récurrents détectés dans votre agence, avec leurs actions et leur vérification.',
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

  // ── Alertes ──────────────────────────────────────────
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [alertesFeedback, setAlertesFeedback] = useState<AlerteFeedback[]>([]);
  const [alertesLoading, setAlertesLoading] = useState(true);

  useEffect(() => {
    if (section !== 'alertes') return;
    alertesApi
      .list()
      .then((r) => {
        setAlertes(r.data?.alertes_seuil || []);
        setAlertesFeedback(r.data?.alertes_feedback || []);
      })
      .catch(() => {
        setAlertes([]);
        setAlertesFeedback([]);
      })
      .finally(() => setAlertesLoading(false));
  }, []);

  const totalAlertes = alertes.length + alertesFeedback.length;

  // ── Action (recommandations IA consolidées réseau) ───
  const [recos, setRecos] = useState<RecommandationOrg[]>([]);
  const [recosTotal, setRecosTotal] = useState(0);
  const [recosLoadingMore, setRecosLoadingMore] = useState(false);
  const [recosLoading, setRecosLoading] = useState(true);
  const [agencesList, setAgencesList] = useState<Agence[]>([]);
  const [selectedAgenceId, setSelectedAgenceId] = useState<string | null>(null);

  useEffect(() => {
    // Le filtre par agence n'a de sens que pour le CX Manager (réseau multi-agences).
    if (isAgencyManager || section === 'suggestions') return;
    agencesApi
      .list()
      .then((res) => {
        if (Array.isArray(res.data)) setAgencesList(res.data);
      })
      .catch(() => setAgencesList([]));
  }, []);

  const fetchRecos = useCallback(async () => {
    setRecosLoading(true);
    try {
      const res = await recommandationsApi.listOrganisation(undefined, { limit: 50, offset: 0 });
      setRecos(res.data || []);
      setRecosTotal(Number(res.headers?.['x-total-count'] || 0));
    } catch {
      setRecos([]);
    } finally {
      setRecosLoading(false);
    }
  }, []);

  const loadMoreRecos = async () => {
    if (recosLoadingMore || recos.length >= recosTotal) return;
    setRecosLoadingMore(true);
    try {
      const res = await recommandationsApi.listOrganisation(undefined, { limit: 50, offset: recos.length });
      setRecos((current) => [...current, ...(res.data || [])]);
    } catch {
      showToast('Impossible de charger les recommandations suivantes');
    } finally {
      setRecosLoadingMore(false);
    }
  };

  useEffect(() => {
    if (section !== 'alertes') return;
    fetchRecos();
  }, [fetchRecos, section]);

  const marquerRecoTraitee = async (id: string) => {
    try {
      await recommandationsApi.marquerTraitee(id);
      setRecos((prev) => prev.filter((r) => r.id !== id));
      setRecosTotal((total) => Math.max(0, total - 1));
    } catch {
      // Silencieux : la recommandation reste visible, l'utilisateur peut réessayer
    }
  };

  const recosAffichees = useMemo(() => {
    return selectedAgenceId ? recos.filter((r) => r.agence_id === selectedAgenceId) : recos;
  }, [recos, selectedAgenceId]);

  // ── Boîte à idées ─────────────────────────────────────
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsTotal, setSuggestionsTotal] = useState(0);
  const [suggestionsLoadingMore, setSuggestionsLoadingMore] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [ideesSubTab, setIdeesSubTab] = useState<'toutes' | 'a_etudier' | 'decisions'>('toutes');

  useEffect(() => {
    if (section !== 'suggestions') return;
    suggestionsApi
      .list({ limit: 50, offset: 0 })
      .then((r) => {
        setSuggestions(r.data || []);
        setSuggestionsTotal(Number(r.headers?.['x-total-count'] || 0));
      })
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, []);

  const loadMoreSuggestions = async () => {
    if (suggestionsLoadingMore || suggestions.length >= suggestionsTotal) return;
    setSuggestionsLoadingMore(true);
    try {
      const res = await suggestionsApi.list({ limit: 50, offset: suggestions.length });
      setSuggestions((current) => [...current, ...(res.data || [])]);
    } catch {
      showToast('Impossible de charger les suggestions suivantes');
    } finally {
      setSuggestionsLoadingMore(false);
    }
  };

  const updateStatut = async (id: string, statut: IdeaStatus) => {
    try {
      await suggestionsApi.updateStatut(id, statut);
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, statut } : s)));
      showToast(`Statut mis à jour : ${STATUS_LABELS[statut]}`);
    } catch {
      showToast('Erreur lors de la mise à jour');
    }
  };

  // ── Actions correctives (suivi + confirmation, pas de création ici) ──
  const [actionsToggle, setActionsToggle] = useState<'en_cours' | 'terminees'>('en_cours');
  const [actionsEnCours, setActionsEnCours] = useState<Feedback[]>([]);
  const [actionsTerminees, setActionsTerminees] = useState<Feedback[]>([]);
  const [actionsEnCoursTotal, setActionsEnCoursTotal] = useState(0);
  const [actionsTermineesTotal, setActionsTermineesTotal] = useState(0);
  const [actionsLoadingMore, setActionsLoadingMore] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsFirstLoadDone, setActionsFirstLoadDone] = useState(false);
  const [actionsAgenceId, setActionsAgenceId] = useState<string | null>(null);

  const fetchActions = useCallback(async () => {
    setActionsLoading(true);
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
    } catch {
      setActionsEnCours([]);
      setActionsTerminees([]);
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
      showToast('Action marquée comme réalisée');
    } catch {
      showToast("Erreur lors de la confirmation de l'action");
    }
  };


  // ── Issues (KPI P0 + liste + détail) ──────────────────
  const [issuesJours, setIssuesJours] = useState(30);
  const [issuesAgenceId, setIssuesAgenceId] = useState<string | null>(null);
  // Vue Backlog : tri par ancienneté (premiere_detection croissant) + Issues non closes
  // uniquement. Désactivée par défaut, pour un comportement strictement inchangé.
  const [backlogActif, setBacklogActif] = useState(false);

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
      const params: { agence_id?: string; tri?: string; limit: number; offset: number } = { limit: 50, offset: 0 };
      if (issuesAgenceId) params.agence_id = issuesAgenceId;
      if (backlogActif) params.tri = 'ancien';
      const res = await issuesApi.list(params);
      setIssuesListRaw(res.data || []);
      setIssuesTotal(Number(res.headers?.['x-total-count'] || 0));
    } catch {
      setIssuesListError(true);
    } finally {
      setIssuesListLoading(false);
      setIssuesFirstLoadDone(true);
    }
  }, [issuesAgenceId, backlogActif]);

  const loadMoreIssues = async () => {
    if (issuesLoadingMore || issuesListRaw.length >= issuesTotal) return;
    setIssuesLoadingMore(true);
    try {
      const params: { agence_id?: string; tri?: string; limit: number; offset: number } = {
        limit: 50, offset: issuesListRaw.length,
      };
      if (issuesAgenceId) params.agence_id = issuesAgenceId;
      if (backlogActif) params.tri = 'ancien';
      const response = await issuesApi.list(params);
      setIssuesListRaw((current) => [...current, ...(response.data || [])]);
    } catch {
      showToast('Impossible de charger les issues suivantes');
    } finally {
      setIssuesLoadingMore(false);
    }
  };

  useEffect(() => {
    if (section !== 'issues') return;
    fetchIssuesList();
  }, [fetchIssuesList, section]);

  // GET /issues/ ne prend pas de paramètre de période (contrairement à GET /kpis) : le
  // filtre "jours" de cet onglet s'applique donc côté client sur premiere_detection,
  // pour rester cohérent avec la définition du KPI Engine (même champ de référence).
  // La vue Backlog ajoute un filtre statut "non closes" côté client également (le
  // paramètre `statut` de l'API ne fait qu'une égalité exacte, pas une exclusion).
  const issuesAffichees = useMemo(() => {
    const seuil = Date.now() - issuesJours * 24 * 60 * 60 * 1000;
    let resultat = issuesListRaw.filter((i) => new Date(i.premiere_detection).getTime() >= seuil);
    if (backlogActif) {
      resultat = resultat.filter((i) => i.statut !== 'resolue' && i.statut !== 'verifiee');
    }
    return resultat;
  }, [issuesListRaw, issuesJours, backlogActif]);

  const issuePlusAncienne = useMemo(() => {
    if (!backlogActif || issuesAffichees.length === 0) return null;
    return issuesAffichees.reduce((plusAncienne, i) =>
      new Date(i.premiere_detection).getTime() < new Date(plusAncienne.premiere_detection).getTime() ? i : plusAncienne
    );
  }, [issuesAffichees, backlogActif]);

  const ancienneteTexte = useMemo(() => {
    if (!issuePlusAncienne) return null;
    const jours = Math.floor((Date.now() - new Date(issuePlusAncienne.premiere_detection).getTime()) / (24 * 60 * 60 * 1000));
    if (jours <= 0) return "la plus ancienne : aujourd'hui";
    return `la plus ancienne : il y a ${jours} jour${jours > 1 ? 's' : ''}`;
  }, [issuePlusAncienne]);

  const issuesOuvertesCount = useMemo(
    () => issuesAffichees.filter((i) => i.statut !== 'verifiee').length,
    [issuesAffichees]
  );

  const openIssueDetail = useCallback(async (issueId: string) => {
    setSelectedIssueId(issueId);
    setIssueDetail(null);
    setIssueDetailLoading(true);
    try {
      const res = await issuesApi.get(issueId);
      setIssueDetail(res.data);
    } catch {
      showToast('Impossible de charger le détail de cette Issue');
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

  const terminerActionIssue = async (issueId: string, actionId: string) => {
    try {
      await issuesApi.terminerAction(issueId, actionId);
      showToast('Action marquée comme terminée');
      await rafraichirApresActionIssue(issueId);
    } catch {
      showToast("Erreur lors de la clôture de l'action");
    }
  };

  const verifierIssue = async (issueId: string) => {
    try {
      await issuesApi.verifier(issueId);
      showToast('Issue marquée comme vérifiée');
      await rafraichirApresActionIssue(issueId);
    } catch {
      showToast("Erreur lors de la vérification de l'Issue");
    }
  };

  const header = SECTION_HEADER[section];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <PageTitle title={header.title} description={isAgencyManager ? header.agency : header.cx} />

      {/* ── SECTION ALERTES & ACTIONS (fusion : alertes réseau + recommandations IA) ── */}
      {section === 'alertes' && <PilotageAlertesActionsTab alertes={alertes} alertesFeedback={alertesFeedback} alertesLoading={alertesLoading} totalAlertes={totalAlertes} isAgencyManager={isAgencyManager} recos={recos} recosAffichees={recosAffichees} recosTotal={recosTotal} recosLoading={recosLoading} recosLoadingMore={recosLoadingMore} loadMoreRecos={loadMoreRecos} agencesList={agencesList} selectedAgenceId={selectedAgenceId} setSelectedAgenceId={setSelectedAgenceId} marquerRecoTraitee={marquerRecoTraitee} />}

      {/* ── SECTION BOÎTE À IDÉES ── */}
      {section === 'suggestions' && <PilotageIdeasTab suggestions={suggestions} suggestionsTotal={suggestionsTotal} suggestionsLoading={suggestionsLoading} suggestionsLoadingMore={suggestionsLoadingMore} loadMoreSuggestions={loadMoreSuggestions} updateStatut={updateStatut} activeSubTab={ideesSubTab} setActiveSubTab={setIdeesSubTab} />}



      {/* ── SECTION ACTIONS CORRECTIVES (suivi + confirmation uniquement — la définition d'une action reste dans FeedbackTreatmentModal) ── */}
      {section === 'actions' && <PilotageActionsCorrectivesTab isAgencyManager={isAgencyManager} agencesList={agencesList} actionsToggle={actionsToggle} setActionsToggle={setActionsToggle} actionsEnCours={actionsEnCours} actionsTerminees={actionsTerminees} actionsEnCoursTotal={actionsEnCoursTotal} actionsTermineesTotal={actionsTermineesTotal} actionsLoading={actionsLoading} actionsFirstLoadDone={actionsFirstLoadDone} actionsLoadingMore={actionsLoadingMore} loadMoreActions={loadMoreActions} actionsAgenceId={actionsAgenceId} setActionsAgenceId={setActionsAgenceId} marquerActionRealisee={marquerActionRealisee} />}



      {/* ── SECTION ISSUES (KPI P0 + liste + détail — pas de création ici, voir rapport) ── */}
      {section === 'issues' && <PilotageIssuesTab isAgencyManager={isAgencyManager} agencesList={agencesList} issuesJours={issuesJours} setIssuesJours={setIssuesJours} issuesAgenceId={issuesAgenceId} setIssuesAgenceId={setIssuesAgenceId} backlogActif={backlogActif} setBacklogActif={setBacklogActif} issuesKpisRefreshToken={issuesKpisRefreshToken} issuesFirstLoadDone={issuesFirstLoadDone} issuesAffichees={issuesAffichees} issuesListRaw={issuesListRaw} issuesTotal={issuesTotal} ancienneteTexte={ancienneteTexte} issuesListError={issuesListError} issuesListLoading={issuesListLoading} fetchIssuesList={fetchIssuesList} openIssueDetail={openIssueDetail} issuesLoadingMore={issuesLoadingMore} loadMoreIssues={loadMoreIssues} selectedIssueId={selectedIssueId} issueDetail={issueDetail} issueDetailLoading={issueDetailLoading} closeIssueDetail={closeIssueDetail} terminerActionIssue={terminerActionIssue} verifierIssue={verifierIssue} />}
    </div>
  );
}

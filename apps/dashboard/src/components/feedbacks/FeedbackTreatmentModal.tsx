import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Feedback, StatutTraitement, HistoriqueFeedback, ReponseClient, UserRole, Issue, IssueStatut, Categorie, CriticiteType } from '../../types';
import { feedbacksApi, issuesApi, agencesApi } from '../../services/api';
import { AVIS_STATUT_LABELS, GRAVITE_LABELS, LIBELLES, PROBLEME_STATUT_LABELS, RESPONSABLE_CX, ROLE_LABELS, SENTIMENT_LABELS } from '../../utils/vocabulaire';
import { enMajusculeInitiale, themeLabel } from '../../utils/themeLabels';
import { userFacingError } from '../../utils/userFacingError';
import { aCriticiteElevee, estNegatif } from '../../utils/triageAvis';
import EmptyState from '../ui/EmptyState';
import { useOverlay } from '../ui/useOverlay';
import PriseEnChargeBanner from './PriseEnChargeBanner';
import WhatsAppReplyButton from './WhatsAppReplyButton';
import { CoordonneesMasquees, ConsentementContact, InfoTraitement } from './DemandeContactBlocs';
import ReponseClientSection from './ReponseClientSection';
import { libelleAnalyseAbsente } from './avisAffichage';
import { shortDate } from '../ui/format';
import { CANAL_LABELS } from '../../utils/brouillonReponse';
import {
  AlertTriangleIcon,
  ClockIcon,
  PhoneIcon,
  CheckCircleIcon,
  PlusIcon,
  UsersIcon,
  CheckIcon,
  MessageSquareIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  SendIcon,
  RefreshIcon,
  TargetIcon,
} from '../common/Icons';

const ISSUE_STATUT_LABELS: Record<IssueStatut, string> = PROBLEME_STATUT_LABELS;
const ISSUE_SEVERITE_LABELS: Record<CriticiteType, string> = GRAVITE_LABELS;

interface FeedbackTreatmentModalProps {
  feedback: Feedback | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateFeedback: (updatedFeedback: Feedback) => void;
  currentUserRole?: UserRole;
  currentUserName?: string;
}

// Libellés de thèmes : source unique dans utils/themeLabels.ts (l'ancienne copie locale divergeait).

const STEPPER_STEPS = [
  { key: 'nouveau', label: AVIS_STATUT_LABELS.nouveau },
  { key: 'en_traitement', label: AVIS_STATUT_LABELS.en_traitement },
  { key: 'en_cours', label: AVIS_STATUT_LABELS.en_cours },
  { key: 'resolu', label: AVIS_STATUT_LABELS.resolu },
];

/** Référence lisible d'un avis (lot 3) : sa date et son agence, à la place d'un identifiant tronqué (« Avis #56536653 »). */
export function referenceAvis(feedback: Pick<Feedback, 'date_soumission' | 'agence_nom'>): string {
  const date = shortDate(feedback.date_soumission);
  return [date ? `Avis du ${date}` : 'Avis', feedback.agence_nom].filter(Boolean).join(' · ');
}

export default function FeedbackTreatmentModal({
  feedback,
  isOpen,
  onClose,
  onUpdateFeedback,
  currentUserRole = 'agency_manager',
  currentUserName = 'Utilisateur',
}: FeedbackTreatmentModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<'traitement' | 'historique' | 'reponses'>('traitement');
  
  // États locaux formulaires
  const [noteInterneInput, setNoteInterneInput] = useState('');
  const [suggestionInput, setSuggestionInput] = useState('');
  const [actionInput, setActionInput] = useState('');

  // Données associées
  const [historiqueList, setHistoriqueList] = useState<HistoriqueFeedback[]>([]);
  const [reponsesList, setReponsesList] = useState<ReponseClient[]>([]);
  const [loadingAction, setLoadingAction] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Issue liée (créer / rattacher / détacher) ──────────
  const [issueLiee, setIssueLiee] = useState<Issue | null>(null);
  const [issueLieeLoading, setIssueLieeLoading] = useState(false);
  const [issueMode, setIssueMode] = useState<'choix' | 'creer' | 'rattacher'>('choix');
  // Section « Problème lié » repliée sur une ligne tant qu'aucun problème n'est lié et que l'utilisateur ne l'ouvre pas.
  const [issueDepliee, setIssueDepliee] = useState(false);

  const [categoriesAgence, setCategoriesAgence] = useState<Categorie[]>([]);
  const [creerTitre, setCreerTitre] = useState('');
  const [creerDescription, setCreerDescription] = useState('');
  const [creerSeverite, setCreerSeverite] = useState<CriticiteType | ''>('');
  const [creerCategorieId, setCreerCategorieId] = useState('');

  const [issuesExistantes, setIssuesExistantes] = useState<Issue[]>([]);
  const [issuesExistantesLoading, setIssuesExistantesLoading] = useState(false);
  const [issuesExistantesErreur, setIssuesExistantesErreur] = useState(false);
  const [issueSelectionneeId, setIssueSelectionneeId] = useState<string | null>(null);

  const isAgencyManager = currentUserRole === 'agency_manager';
  const isCXManager = currentUserRole === 'cx_manager' || currentUserRole === 'admin';
  // Reflet de la règle du serveur (CX-08), qui reste seule juge : avis négatif ou de gravité élevée/critique.
  const actionPermise = feedback ? estNegatif(feedback) || aCriticiteElevee(feedback) : false;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Chargement de l'historique et des réponses
  const loadHistoriqueAndReponses = useCallback(async (fId: string) => {
    try {
      const [histRes, repRes] = await Promise.all([
        feedbacksApi.getHistorique(fId),
        feedbacksApi.getReponses(fId),
      ]);
      setHistoriqueList(histRes.data || []);
      setReponsesList(repRes.data || []);
    } catch (err) {
      console.error('Erreur chargement détails:', err);
    }
  }, []);

  // 1. Ouverture = CONSULTATION : on charge l'historique et les réponses, sans modifier le statut ni l'attribution.
  //    La prise en charge est l'action explicite « Prendre en charge » (voir PriseEnChargeBanner).
  useEffect(() => {
    if (!isOpen || !feedback) return;
    // Le rétrécissement de type ne traverse pas la frontière de la fonction imbriquée : on capture la valeur non nulle.
    const fb = feedback;

    let isMounted = true;
    if (isMounted) {
      loadHistoriqueAndReponses(fb.id);
    }

    // Reset des inputs
    setNoteInterneInput('');
    setSuggestionInput('');
    setActionInput(feedback.action_a_prendre || '');
    setActiveTab('traitement');

    // Reset Issue liée
    setIssueMode('choix');
    setCreerTitre('');
    setCreerDescription('');
    setCreerSeverite(fb.analyse_ia?.criticite || '');
    setCreerCategorieId(fb.categorie_id || '');
    setIssuesExistantes([]);
    setIssueSelectionneeId(null);
    setIssueLiee(null);
    if (fb.issue_id) {
      setIssueLieeLoading(true);
      issuesApi
        .get(fb.issue_id)
        .then((res) => {
          if (isMounted) setIssueLiee(res.data);
        })
        .catch(() => {})
        .finally(() => {
          if (isMounted) setIssueLieeLoading(false);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [feedback?.id, isOpen]);

  // Comportement de modale commun : focus piégé dans la fenêtre, Échap, retour du focus au déclencheur.
  const panelRef = useOverlay<HTMLDivElement>(isOpen && !!feedback, onClose);

  if (!isOpen || !feedback) return null;

  const currentStatut: StatutTraitement = feedback.statut_traitement || 'en_traitement';
  const isPositiveFeedback = feedback.note >= 4 && feedback.analyse_ia?.sentiment === 'positif' && !feedback.demande_contact?.souhaite_etre_rappele;

  // Calcul d'étape active dans le stepper
  const getStepIndex = (st: StatutTraitement) => {
    if (st === 'nouveau') return 0;
    if (st === 'en_traitement') return 1;
    if (st === 'en_cours') return 2;
    if (st === 'resolu') return 3;
    return 1;
  };
  const currentStepIdx = getStepIndex(currentStatut);

  // ── Actions Métier ──────────────────────────────────────────────────────────

  // 1. Ajouter une note interne
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInterneInput.trim()) return;
    setLoadingAction(true);
    try {
      const res = await feedbacksApi.addNote(feedback.id, noteInterneInput.trim());
      onUpdateFeedback(res.data);
      setNoteInterneInput('');
      await loadHistoriqueAndReponses(feedback.id);
      showToast('Note interne enregistrée dans l’historique');
    } catch {
      showToast('Erreur lors de l’enregistrement de la note');
    } finally {
      setLoadingAction(false);
    }
  };

  // 1bis. Responsable d'agence : prise en charge explicite (Nouveau -> Pris en charge, attribution à soi)
  const handlePrendreEnCharge = async () => {
    if (!feedback) return;
    setLoadingAction(true);
    try {
      const res = await feedbacksApi.prendreEnCharge(feedback.id);
      onUpdateFeedback(res.data);
      await loadHistoriqueAndReponses(feedback.id);
      showToast('Avis pris en charge : il vous est attribué');
    } catch {
      showToast('Erreur lors de la prise en charge de l’avis');
    } finally {
      setLoadingAction(false);
    }
  };

  // 2. Agency Manager : Envoyer suggestion au CX
  const handleEnvoyerSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestionInput.trim()) return;
    setLoadingAction(true);
    try {
      const res = await feedbacksApi.envoyerSuggestionAgence(feedback.id, suggestionInput.trim());
      onUpdateFeedback(res.data);
      setSuggestionInput('');
      await loadHistoriqueAndReponses(feedback.id);
      showToast(`✓ Suggestion transmise au ${RESPONSABLE_CX}`);
    } catch {
      showToast('Erreur lors de l’envoi de la suggestion');
    } finally {
      setLoadingAction(false);
    }
  };

  // Un 409 signifie que le statut a changé depuis l'ouverture de la fenêtre (autre utilisateur, autre onglet) :
  // on recharge l'avis pour que les boutons proposés correspondent à son état réel.
  const MESSAGE_STATUT_CHANGE = 'Le statut de cet avis a changé entre-temps. Les informations ont été actualisées : vérifiez-les puis réessayez.';
  const resynchroniser = async (err: unknown) => {
    if (!(err as { response?: { status?: number } })?.response || (err as { response: { status?: number } }).response.status !== 409) return;
    try {
      const res = await feedbacksApi.get(feedback.id);
      onUpdateFeedback(res.data);
      await loadHistoriqueAndReponses(feedback.id);
    } catch { /* l'avis reste affiché tel quel ; le message ci-dessus suffit */ }
  };

  // 3. CX Manager : Définir l'action corrective (En traitement -> En cours)
  const handleDefinirActionCX = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionInput.trim()) return;
    setLoadingAction(true);
    try {
      const res = await feedbacksApi.definirActionCX(feedback.id, actionInput.trim());
      onUpdateFeedback(res.data);
      await loadHistoriqueAndReponses(feedback.id);
      showToast('Action enregistrée : statut passé à « Action en cours »');
    } catch (err) {
      showToast(userFacingError(err, 'Erreur lors de l’enregistrement de l’action', undefined, { 409: MESSAGE_STATUT_CHANGE }));
      await resynchroniser(err);
    } finally {
      setLoadingAction(false);
    }
  };

  // 4. CX Manager : Confirmer l'action réalisée (En cours -> Résolu)
  const handleConfirmerActionRealisee = async () => {
    setLoadingAction(true);
    try {
      const res = await feedbacksApi.confirmerActionRealisee(feedback.id);
      onUpdateFeedback(res.data);
      await loadHistoriqueAndReponses(feedback.id);
      showToast('✓ Action confirmée : avis marqué comme résolu');
    } catch (err) {
      showToast(userFacingError(err, 'Erreur lors de la confirmation de l’action', undefined, { 409: MESSAGE_STATUT_CHANGE }));
      await resynchroniser(err);
    } finally {
      setLoadingAction(false);
    }
  };

  // 6. Réouverture si feedback résolu
  const handleReouvrir = async () => {
    setLoadingAction(true);
    try {
      const res = await feedbacksApi.reouvrir(feedback.id);
      onUpdateFeedback(res.data);
      await loadHistoriqueAndReponses(feedback.id);
      showToast('Avis rouvert : statut repassé à « Pris en charge »');
    } catch (err) {
      showToast(userFacingError(err, 'Erreur lors de la réouverture', undefined, { 409: MESSAGE_STATUT_CHANGE }));
      await resynchroniser(err);
    } finally {
      setLoadingAction(false);
    }
  };

  // ── Issue liée ────────────────────────────────────────────────────────────

  // Recharge le feedback complet (pour que issue_id soit à jour) sans fermer la modale.
  const refreshFeedback = useCallback(async () => {
    try {
      const res = await feedbacksApi.get(feedback.id);
      onUpdateFeedback(res.data);
    } catch {
      // Le feedback affiché reste celui d'avant si le refetch échoue ; l'action elle-même
      // (créer/rattacher/détacher) a déjà réussi ou échoué indépendamment de ce refresh.
    }
  }, [feedback.id, onUpdateFeedback]);

  const ouvrirCreationIssue = async () => {
    setIssueMode('creer');
    if (categoriesAgence.length === 0 && feedback.agence_id) {
      try {
        const res = await agencesApi.listCategories(feedback.agence_id);
        setCategoriesAgence(res.data || []);
      } catch {
        setCategoriesAgence([]);
      }
    }
  };

  const ouvrirRattachement = async () => {
    setIssueMode('rattacher');
    if (!feedback.agence_id) return;
    setIssuesExistantesLoading(true);
    setIssuesExistantesErreur(false);
    try {
      const res = await issuesApi.list({ agence_id: feedback.agence_id });
      // Les Issues déjà vérifiées ne sont pas proposées ici : y rattacher un feedback les
      // rouvre automatiquement côté backend (comportement voulu, mais pas le premier choix).
      setIssuesExistantes((res.data || []).filter((i) => i.statut !== 'verifiee'));
    } catch {
      // Une erreur n'est pas une liste vide : on le dit et on propose de réessayer.
      setIssuesExistantes([]);
      setIssuesExistantesErreur(true);
    } finally {
      setIssuesExistantesLoading(false);
    }
  };

  const handleCreerIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creerTitre.trim() || !feedback.agence_id || !creerSeverite) return;
    setLoadingAction(true);
    try {
      const res = await issuesApi.create({
        titre: creerTitre.trim(),
        description: creerDescription.trim() || undefined,
        agence_id: feedback.agence_id,
        categorie_id: creerCategorieId || undefined,
        severite: creerSeverite,
        feedback_ids: [feedback.id],
      });
      setIssueLiee(res.data);
      setIssueMode('choix');
      await refreshFeedback();
      showToast('Problème créé et avis rattaché');
    } catch {
      showToast("Impossible de créer le problème");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleRattacherIssue = async () => {
    if (!issueSelectionneeId) return;
    setLoadingAction(true);
    try {
      const res = await issuesApi.rattacherFeedback(issueSelectionneeId, feedback.id);
      setIssueLiee(res.data);
      setIssueMode('choix');
      await refreshFeedback();
      showToast('Avis rattaché au problème');
    } catch {
      showToast('Erreur lors du rattachement');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDetacherIssue = async () => {
    if (!feedback.issue_id) return;
    if (!window.confirm(`Détacher cet avis du problème "${issueLiee?.titre || ''}" ?`)) return;
    setLoadingAction(true);
    try {
      await issuesApi.detacherFeedback(feedback.issue_id, feedback.id);
      setIssueLiee(null);
      setIssueMode('choix');
      await refreshFeedback();
      showToast('Avis détaché du problème');
    } catch {
      showToast('Erreur lors du détachement');
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--overlay-scrim)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding: '16px',
        boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes modalPopIn {
          from { opacity: 0; transform: scale(0.96) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (max-width: 640px) {
          .feedback-treatment-dialog { max-height: calc(100dvh - 32px) !important; border-radius: 20px 20px 0 0 !important; }
          .feedback-treatment-header { padding: 16px !important; gap: 12px; }
          .feedback-treatment-header-meta { flex-wrap: wrap; }
          .feedback-treatment-stepper { padding: 12px 16px !important; gap: 8px; flex-wrap: wrap; }
          .feedback-treatment-stepper > div { gap: 5px !important; }
          .feedback-treatment-metadata { padding: 12px 16px !important; gap: 8px !important; }
          .feedback-treatment-tabs { padding: 0 12px !important; overflow-x: auto; }
          .feedback-treatment-tabs button { padding: 10px 12px !important; white-space: nowrap; min-height: 44px; }
          .feedback-treatment-body { padding: 16px !important; }
        }
      `}</style>

      {/* Conteneur Modale SaaS */}
      <div
        ref={panelRef}
        className="feedback-treatment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-treatment-title"
        tabIndex={-1}
        style={{
          width: '780px',
          maxWidth: '100%',
          maxHeight: 'min(92vh, 900px)',
          background: 'var(--color-surface)',
          borderRadius: '24px',
          boxShadow: 'var(--shadow-overlay)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalPopIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <div
          className="on-dark feedback-treatment-header"
          style={{
            background: 'var(--color-encre)',
            color: 'var(--color-text-inverse)',
            padding: '22px 28px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div>
            <div className="feedback-treatment-header-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span
                style={{
                  color: 'var(--color-text-on-dark-muted)',
                  fontWeight: 'var(--weight-semibold)',
                  fontSize: 'var(--text-xs)',
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Traitement de l’avis
              </span>
            </div>
            <h2 id="feedback-treatment-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', margin: 0, letterSpacing: '-0.02em' }}>
              {referenceAvis(feedback)}
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            data-autofocus
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: 'var(--color-text-inverse)',
              width: '44px',
              height: '44px',
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--weight-semibold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Toast de confirmation ─────────────────────────────── */}
        {toastMessage && (
          <div
            style={{
              background: 'var(--color-bon-fond)',
              color: 'var(--color-bon-texte)',
              padding: '10px 24px',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              textAlign: 'center',
            }}
          >
            {toastMessage}
          </div>
        )}

        {/* ── Workflow Stepper Informatif (Non-cliquable) ──────── */}
        <div
          className="feedback-treatment-stepper"
          style={{
            background: 'var(--color-bg)',
            padding: '16px 28px',
            borderBottom: '1px solid var(--color-trait)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {STEPPER_STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIdx || currentStatut === 'resolu';
            const isActive = idx === currentStepIdx && currentStatut !== 'resolu';
            const isFuture = idx > currentStepIdx;

            let dotBg = 'var(--color-neutre-fond)';
            let dotColor = 'var(--color-text-2)';
            let labelColor = 'var(--color-text-2)';
            let labelWeight = 'var(--weight-normal)';

            if (isCompleted) {
              dotBg = 'var(--color-marque)';
              dotColor = 'var(--color-text-inverse)';
              labelColor = 'var(--color-encre)';
              labelWeight = 'var(--weight-semibold)';
            } else if (isActive) {
              dotBg = 'var(--color-encre)';
              dotColor = 'var(--color-text-inverse)';
              labelColor = 'var(--color-encre)';
              labelWeight = 'var(--weight-semibold)';
            }

            return (
              <React.Fragment key={step.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: dotBg,
                      color: dotColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                    }}
                  >
                    {isCompleted ? '✓' : idx + 1}
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)', color: labelColor, fontWeight: labelWeight }}>
                    {step.label}
                  </span>
                </div>
                {idx < STEPPER_STEPS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: '2px',
                      background: idx < currentStepIdx ? 'var(--color-marque)' : 'var(--color-trait)',
                      margin: '0 12px',
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Metadata Badges Bar ───────────────────────────────── */}
        <div
          className="feedback-treatment-metadata"
          style={{
            padding: '14px 28px',
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-trait)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '12px',
            fontSize: 'var(--text-sm)',
          }}
        >
          {/* Note */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--color-bg)', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--color-trait)', fontWeight: 'var(--weight-semibold)' }}>
            <span>Note :</span>
            <span className="t-encre" aria-hidden="true">{'★'.repeat(feedback.note)}{'☆'.repeat(5 - feedback.note)}</span>
            <span className="t-2">({feedback.note}/5)</span>
          </div>

          {/* Sentiment */}
          <div
            style={{
              padding: '4px 10px',
              borderRadius: '8px',
              fontWeight: 'var(--weight-semibold)',
              background: feedback.analyse_ia?.sentiment === 'positif' ? 'var(--color-bon-fond)' : feedback.analyse_ia?.sentiment === 'negatif' ? 'var(--color-critique-fond)' : 'var(--color-surveiller-fond)',
              color: feedback.analyse_ia?.sentiment === 'positif' ? 'var(--color-bon-texte)' : feedback.analyse_ia?.sentiment === 'negatif' ? 'var(--color-critique-texte)' : 'var(--color-surveiller-texte)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            {feedback.analyse_ia?.sentiment === 'positif' && <ThumbsUpIcon size={12} color="var(--color-bon-texte)" />}
            {feedback.analyse_ia?.sentiment === 'negatif' && <ThumbsDownIcon size={12} color="var(--color-critique-texte)" />}
            <span>Ton : {feedback.analyse_ia ? (feedback.analyse_ia.sentiment ? SENTIMENT_LABELS[feedback.analyse_ia.sentiment] ?? feedback.analyse_ia.sentiment : 'Non évalué') : libelleAnalyseAbsente(feedback)}</span>
          </div>

          {/* Criticité : afficher uniquement l'analyse réelle et distinguer une valeur absente. */}
          <div style={{ background: feedback.analyse_ia?.criticite === 'critique' ? 'var(--color-critique-fond)' : feedback.analyse_ia?.criticite === 'elevee' ? 'var(--color-surveiller-fond)' : 'var(--color-bg)', color: feedback.analyse_ia?.criticite === 'critique' ? 'var(--color-critique-texte)' : feedback.analyse_ia?.criticite === 'elevee' ? 'var(--color-critique-texte)' : 'var(--color-text-2)', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--color-trait)', fontWeight: 'var(--weight-semibold)' }}>
            Urgence : {feedback.analyse_ia ? (feedback.analyse_ia.criticite ? GRAVITE_LABELS[feedback.analyse_ia.criticite] ?? feedback.analyse_ia.criticite : 'Non évaluée') : libelleAnalyseAbsente(feedback)}
          </div>
          {feedback.analyse_ia?.discordance_detectee && (
            <div role="status" style={{ background: 'var(--color-surveiller-fond)', color: 'var(--color-surveiller-texte)', padding: '4px 10px', borderRadius: '8px', fontWeight: 'var(--weight-semibold)' }}>
              <span title="La note donnée ne correspond pas au ton du commentaire (ex. 5/5 avec un commentaire négatif).">Note et commentaire contradictoires</span>
            </div>
          )}

          {/* Statut Badge */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="t-sm t-2 t-semi">Statut :</span>
            <span
              style={{
                padding: '4px 12px',
                borderRadius: '9999px',
                fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-xs)',
                background: currentStatut === 'resolu' ? 'var(--color-bon-fond)' : currentStatut === 'en_cours' ? 'var(--color-surveiller-fond)' : currentStatut === 'en_traitement' ? 'var(--color-neutre-fond)' : 'var(--color-critique-fond)',
                color: currentStatut === 'resolu' ? 'var(--color-bon-texte)' : currentStatut === 'en_cours' ? 'var(--color-surveiller-texte)' : currentStatut === 'en_traitement' ? 'var(--color-neutre-texte)' : 'var(--color-critique-texte)',
              }}
            >
              {AVIS_STATUT_LABELS[currentStatut] ?? AVIS_STATUT_LABELS.nouveau}
            </span>
          </div>
        </div>

        <PriseEnChargeBanner statut={currentStatut} role={currentUserRole} chargement={loadingAction} onPrendreEnCharge={handlePrendreEnCharge} />

        {/* ── Navigation Onglets ────────────────────────────────── */}
        <div className="feedback-treatment-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--color-trait)', background: 'var(--color-bg)', padding: '0 28px' }}>
          {[
            { id: 'traitement', label: 'Traitement', icon: <ClockIcon size={14} /> },
            { id: 'historique', label: `Historique (${historiqueList.length})`, icon: <UsersIcon size={14} /> },
            { id: 'reponses', label: `Réponses au client (${reponsesList.length})`, icon: <MessageSquareIcon size={14} /> },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: '12px 18px',
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--color-encre)' : '2px solid transparent',
                  color: active ? 'var(--color-encre)' : 'var(--color-text-2)',
                  fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-semibold)',
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Corps Principal Scrollable ────────────────────────── */}
        <div className="feedback-treatment-body" style={{ flex: 1, minHeight: 0, padding: '24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* ONGLET 1 : TRAITEMENT OPÉRATIONNEL */}
          {activeTab === 'traitement' && (
            <>
              {/* 1. Commentaire Client Original */}
              <div
                style={{
                  background: 'var(--color-bg)',
                  borderRadius: '16px',
                  padding: '18px 20px',
                  border: '1px solid var(--color-trait)',
                }}
              >
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  COMMENTAIRE DU CLIENT
                </div>
                <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-encre)', lineHeight: 1.55, fontStyle: feedback.commentaire ? 'normal' : 'italic' }}>
                  "{feedback.commentaire || 'Pas de commentaire écrit.'}"
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', padding: '0 2px', color: 'var(--color-text-2)', fontSize: 'var(--text-sm)' }} aria-label="Contexte de l’avis">
                <span><strong className="t-encre">Agence :</strong> {feedback.agence_nom || 'Non renseignée'}</span>
                <span><strong className="t-encre">Date :</strong> {new Date(feedback.date_soumission).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span><strong className="t-encre">Thème :</strong> {feedback.analyse_ia?.theme_principal ? themeLabel(feedback.analyse_ia.theme_principal) : 'Non catégorisé'}</span>
                {feedback.assigne_a_nom && <span><strong className="t-encre">Pris en charge par :</strong> {feedback.assigne_a_nom}</span>}
              </div>

              {/* 2. Feedback Positif Sans Action Requise */}
              {isPositiveFeedback && (
                <div
                  style={{
                    background: 'var(--color-bon-fond)',
                    border: '1px solid var(--color-trait)',
                    borderRadius: '16px',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    color: 'var(--color-encre)',
                  }}
                >
                  <ThumbsUpIcon size={20} color="var(--color-bon-texte)" />
                  <div className="t-sm t-semi">
                    Avis positif : aucune action n’est nécessaire.
                  </div>
                </div>
              )}

              {/* 3. Informations Client */}
              {feedback.demande_contact && (feedback.demande_contact.telephone || feedback.demande_contact.email || feedback.demande_contact.souhaite_etre_rappele || feedback.demande_contact.coordonnees_masquees) && (
                <div
                  style={{
                    background: 'var(--color-surveiller-fond)',
                    border: '1px solid var(--color-surveiller-fond)',
                    borderRadius: '18px',
                    padding: '18px 20px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-critique-texte)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <PhoneIcon size={15} color="var(--color-critique-texte)" />
                      <span>INFORMATIONS CLIENT</span>
                    </div>
                    {feedback.demande_contact.souhaite_etre_rappele && (
                      <span style={{ background: 'var(--color-critique-fond)', color: 'var(--color-critique-texte)', padding: '2px 8px', borderRadius: '6px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                        Rappel souhaité
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-critique-texte)', display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '12px' }}>
                    {feedback.demande_contact.nom && <div><strong>Nom :</strong> {feedback.demande_contact.nom}</div>}
                    {feedback.demande_contact.telephone && (
                      <div>
                        <strong>Téléphone :</strong>{' '}
                        <a href={`tel:${feedback.demande_contact.telephone}`} style={{ color: 'var(--color-critique-texte)', fontWeight: 'var(--weight-semibold)', textDecoration: 'none' }}>
                          {feedback.demande_contact.telephone}
                        </a>
                      </div>
                    )}
                    {feedback.demande_contact.email && (
                      <div>
                        <strong>E-mail :</strong>{' '}
                        <a href={`mailto:${feedback.demande_contact.email}`} style={{ color: 'var(--color-critique-texte)', fontWeight: 'var(--weight-semibold)', textDecoration: 'none' }}>
                          {feedback.demande_contact.email}
                        </a>
                      </div>
                    )}
                  </div>

                  {feedback.demande_contact.coordonnees_masquees && <div style={{ marginBottom: '8px' }}><CoordonneesMasquees /></div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                    <InfoTraitement demande={feedback.demande_contact} />
                    <ConsentementContact demande={feedback.demande_contact} />
                  </div>

                  {/* Réponse WhatsApp (Agency Manager uniquement) : ouvre wa.me, aucun envoi ni marquage « traitée ». */}
                  {isAgencyManager && !feedback.demande_contact.coordonnees_masquees && (
                    <div style={{ marginBottom: '12px' }}>
                      <WhatsAppReplyButton
                        telephone={feedback.demande_contact.telephone}
                        telephoneWhatsapp={feedback.demande_contact.telephone_whatsapp}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 3 bis. Répondre au client : toujours visible (avec ou sans demande de contact), brouillon proposé par l'API si l'avis demande un suivi. */}
              <ReponseClientSection
                feedbackId={feedback.id}
                demande={feedback.demande_contact}
                onEnregistree={async (reponses) => {
                  setReponsesList(reponses);
                  await loadHistoriqueAndReponses(feedback.id);
                }}
                onNotifier={showToast}
              />

              {/* 4. WORKFLOW AGENCY MANAGER : Suggestion pour le CX */}
              {isAgencyManager && (
                <div
                  style={{
                    background: 'var(--color-bg)',
                    borderRadius: '18px',
                    padding: '18px 20px',
                    border: '1px solid var(--color-trait)',
                  }}
                >
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Suggestion pour le {RESPONSABLE_CX}
                  </div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', margin: '0 0 12px 0' }}>
                    Proposez une solution ou une amélioration terrain au {RESPONSABLE_CX}. L’avis restera « Pris en charge » jusqu’à ce qu’une action soit définie.
                  </p>

                  {feedback.suggestion_agence ? (
                    <div style={{ background: 'var(--color-bon-fond)', border: '1px solid var(--color-trait)', borderRadius: '12px', padding: '12px 14px', color: 'var(--color-encre)', fontSize: 'var(--text-sm)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'var(--weight-semibold)', marginBottom: '4px', color: 'var(--color-bon-texte)' }}>
                        <CheckIcon size={14} />
                        <span>Suggestion transmise au {RESPONSABLE_CX}</span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontStyle: 'italic' }}>"{feedback.suggestion_agence}"</p>
                      {feedback.suggestion_agence_auteur && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', marginTop: '6px' }}>
                          Par {feedback.suggestion_agence_auteur} {feedback.suggestion_agence_date ? `le ${new Date(feedback.suggestion_agence_date).toLocaleDateString('fr-FR')}` : ''}
                        </div>
                      )}
                    </div>
                  ) : (
                    <form onSubmit={handleEnvoyerSuggestion}>
                      <textarea
                        rows={3}
                        value={suggestionInput}
                        onChange={(e) => setSuggestionInput(e.target.value)}
                        placeholder="Exemple : Augmenter le personnel à l'accueil entre 12h et 14h pour résorber la file d'attente..."
                        style={{
                          width: '100%',
                          padding: '12px',
                          borderRadius: '12px',
                          border: '1px solid var(--color-trait)',
                          background: 'var(--color-surface)',
                          fontFamily: 'inherit',
                          fontSize: 'var(--text-sm)',
                          resize: 'none',
                          boxSizing: 'border-box',
                          marginBottom: '10px',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={loadingAction || !suggestionInput.trim()}
                        className="btn-primary"
                        style={{
                          padding: '10px 18px',
                          fontSize: 'var(--text-sm)',
                          borderRadius: '12px',
                          opacity: suggestionInput.trim() ? 1 : 0.5,
                          cursor: suggestionInput.trim() ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <SendIcon size={13} />
                        <span>{loadingAction ? 'Envoi en cours...' : `Envoyer la suggestion au ${RESPONSABLE_CX}`}</span>
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* 5. WORKFLOW CX MANAGER : Suggestion Agence & Action à Prendre */}
              {isCXManager && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Suggestion reçue de l'agence (Lecture seule) */}
                  {feedback.suggestion_agence && (
                    <div
                      style={{
                        background: 'var(--color-neutre-fond)',
                        border: '1px solid var(--color-neutre-fond)',
                        borderRadius: '18px',
                        padding: '16px 20px',
                      }}
                    >
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-neutre-texte)', marginBottom: '6px', textTransform: 'uppercase' }}>
                        SUGGESTION DE L'AGENCE ({feedback.agence_nom || 'Agence'})
                      </div>
                      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-encre)', fontStyle: 'italic', lineHeight: 1.5 }}>
                        "{feedback.suggestion_agence}"
                      </p>
                      {feedback.suggestion_agence_auteur && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', marginTop: '6px' }}>
                          Soumis par {feedback.suggestion_agence_auteur}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Définition ou Confirmation d'Action Corrective — repliée sur une ligne tant qu'il n'y a rien à faire ni à lire */}
                  {!['en_traitement', 'en_cours', 'resolu'].includes(currentStatut) ? (
                    <p className="ftm-ligne-repliee"><strong>{LIBELLES.action}</strong> : aucune définie pour l’instant.</p>
                  ) : (
                  <div
                    style={{
                      background: 'var(--color-bg)',
                      borderRadius: '18px',
                      padding: '18px 20px',
                      border: '1px solid var(--color-trait)',
                    }}
                  >
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', marginBottom: '8px', textTransform: 'uppercase' }}>
                      ACTION À MENER (DÉFINIE PAR LE CX MANAGER)
                    </div>

                    {currentStatut === 'en_traitement' && !actionPermise && (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', margin: 0 }}>
                        Une action se définit seulement sur un avis critique ou négatif. Cet avis n’est ni l’un ni l’autre.
                      </p>
                    )}

                    {currentStatut === 'en_traitement' && actionPermise && (
                      <form onSubmit={handleDefinirActionCX}>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', margin: '0 0 10px 0' }}>
                          Décrivez l’action. Dès l’enregistrement, le statut passera à <strong>« Action en cours »</strong>.
                        </p>
                        <textarea
                          rows={3}
                          value={actionInput}
                          onChange={(e) => setActionInput(e.target.value)}
                          placeholder="Exemple : Planifier un renfort de 2 conseillers supplémentaires de 12h à 14h..."
                          style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '12px',
                            border: '1px solid var(--color-trait)',
                            background: 'var(--color-surface)',
                            fontFamily: 'inherit',
                            fontSize: 'var(--text-sm)',
                            resize: 'none',
                            boxSizing: 'border-box',
                            marginBottom: '10px',
                          }}
                        />
                        <button
                          type="submit"
                          disabled={loadingAction || !actionInput.trim()}
                          className="btn-primary"
                          style={{
                            padding: '10px 18px',
                            fontSize: 'var(--text-sm)',
                            borderRadius: '12px',
                            opacity: actionInput.trim() ? 1 : 0.5,
                            cursor: actionInput.trim() ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <PlusIcon size={14} />
                          <span>{loadingAction ? 'Enregistrement...' : 'Enregistrer l’action'}</span>
                        </button>
                      </form>
                    )}

                    {currentStatut === 'en_cours' && (
                      <div>
                        <div style={{ background: 'var(--color-surveiller-fond)', border: '1px solid var(--color-surveiller-fond)', borderRadius: '12px', padding: '12px 14px', marginBottom: '14px' }}>
                          <div className="t-xs t-surveiller t-semi">ACTION À MENER (PAS ENCORE CONFIRMÉE) :</div>
                          <p style={{ margin: '4px 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-surveiller-texte)', fontWeight: 'var(--weight-semibold)' }}>
                            "{feedback.action_a_prendre || actionInput}"
                          </p>
                        </div>
                        <button
                          onClick={handleConfirmerActionRealisee}
                          disabled={loadingAction}
                          className="btn-primary"
                          style={{ width: '100%', padding: '12px', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', justifyContent: 'center' }}
                        >
                          <CheckCircleIcon size={16} />
                          <span>{loadingAction ? 'Validation en cours...' : 'Confirmer l’action réalisée → Résoudre l’avis'}</span>
                        </button>
                      </div>
                    )}

                    {currentStatut === 'resolu' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bon-fond)', border: '1px solid var(--color-trait)', borderRadius: '12px', padding: '14px 16px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>
                            <CheckCircleIcon size={16} />
                            <span>Avis marqué comme résolu</span>
                          </div>
                          {feedback.action_a_prendre && (
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-encre)', marginTop: '4px' }}>
                              Action réalisée : "{feedback.action_a_prendre}"
                            </div>
                          )}
                        </div>
                        <button
                          onClick={handleReouvrir}
                          disabled={loadingAction}
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: 'var(--text-xs)', borderRadius: '8px' }}
                        >
                          <RefreshIcon size={12} />
                          <span>Rouvrir</span>
                        </button>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              )}

              {/* 5bis. ISSUE LIÉE (CX Manager & Agency Manager) — créer, rattacher ou détacher. Repliée sur une ligne sans problème lié. */}
              {!issueLieeLoading && !feedback.issue_id && issueMode === 'choix' && !issueDepliee ? (
                <div className="ftm-ligne-repliee ftm-ligne-repliee--action">
                  <span><strong>Problème à traiter lié</strong> : aucun.</span>
                  <button type="button" className="btn-secondary" style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', borderRadius: '8px' }} onClick={() => setIssueDepliee(true)} aria-expanded={false}>
                    Lier à un problème
                  </button>
                </div>
              ) : (
              <div
                style={{
                  background: 'var(--color-surface)',
                  borderRadius: '18px',
                  padding: '18px 20px',
                  border: '1px solid var(--color-trait)',
                }}
              >
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', marginBottom: '10px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <TargetIcon size={15} color="var(--color-encre)" />
                  <span>Problème à traiter lié</span>
                </div>

                {issueLieeLoading ? (
                  <div className="t-sm t-2">Chargement...</div>
                ) : feedback.issue_id ? (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-trait)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div className="t-sm t-encre">
                      Rattaché au problème : <strong>{issueLiee?.titre || '…'}</strong>
                      {issueLiee && (
                        <span style={{ marginLeft: '8px', fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>
                          ({ISSUE_STATUT_LABELS[issueLiee.statut]} · {ISSUE_SEVERITE_LABELS[issueLiee.severite]})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleDetacherIssue}
                      disabled={loadingAction}
                      style={{ background: 'var(--color-surface)', color: 'var(--color-critique-texte)', border: '1px solid var(--color-critique-fond)', borderRadius: '10px', padding: '6px 12px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', cursor: 'pointer' }}
                    >
                      Détacher
                    </button>
                  </div>
                ) : issueMode === 'choix' ? (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={ouvrirCreationIssue}
                      className="btn-primary"
                      style={{ padding: '8px 14px', fontSize: 'var(--text-xs)', borderRadius: '10px' }}
                    >
                      <PlusIcon size={13} />
                      <span>Créer un nouveau problème</span>
                    </button>
                    <button
                      type="button"
                      onClick={ouvrirRattachement}
                      className="btn-secondary"
                      style={{ padding: '8px 14px', fontSize: 'var(--text-xs)', borderRadius: '10px' }}
                    >
                      Rattacher à un problème existant
                    </button>
                  </div>
                ) : issueMode === 'creer' ? (
                  <form onSubmit={handleCreerIssue} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                      type="text"
                      value={creerTitre}
                      onChange={(e) => setCreerTitre(e.target.value)}
                      placeholder="Titre du problème"
                      required
                      style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--color-trait)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <textarea
                      rows={2}
                      value={creerDescription}
                      onChange={(e) => setCreerDescription(e.target.value)}
                      placeholder="Description (optionnelle)"
                      style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--color-trait)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <select
                        value={creerSeverite}
                        onChange={(e) => setCreerSeverite(e.target.value as CriticiteType)}
                        required
                        style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid var(--color-trait)', fontSize: 'var(--text-sm)', fontFamily: 'inherit' }}
                      >
                        <option value="">Choisir l’urgence</option>
                        {/* Trois niveaux affichés ; « Normale » enregistre la valeur « moyenne » (valeurs en base inchangées). */}
                        {(['critique', 'elevee', 'moyenne'] as CriticiteType[]).map((s) => (
                          <option key={s} value={s}>{ISSUE_SEVERITE_LABELS[s]}</option>
                        ))}
                      </select>
                      <select
                        value={creerCategorieId}
                        onChange={(e) => setCreerCategorieId(e.target.value)}
                        style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid var(--color-trait)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', minWidth: '160px' }}
                      >
                        <option value="">Sans catégorie</option>
                        {categoriesAgence.map((c) => (
                          <option key={c.id} value={c.id}>{enMajusculeInitiale(c.nom)}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button type="button" onClick={() => setIssueMode('choix')} className="btn-secondary" style={{ padding: '6px 12px', borderRadius: '8px' }}>
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={loadingAction || !creerTitre.trim() || !creerSeverite}
                        className="btn-primary"
                        style={{ padding: '8px 16px', fontSize: 'var(--text-xs)', borderRadius: '10px', opacity: creerTitre.trim() && creerSeverite ? 1 : 0.5, cursor: creerTitre.trim() && creerSeverite ? 'pointer' : 'not-allowed' }}
                      >
                        {loadingAction ? 'Création...' : 'Créer le problème'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {issuesExistantesLoading ? (
                      <div className="t-sm t-2">Chargement des problèmes…</div>
                    ) : issuesExistantesErreur ? (
                      <EmptyState
                        illustration="no-data"
                        title="Impossible de charger les problèmes"
                        message="La liste des problèmes de cette agence n’a pas pu être chargée. Vérifiez votre connexion puis réessayez."
                        action={{ label: 'Réessayer', onClick: ouvrirRattachement }}
                      />
                    ) : issuesExistantes.length === 0 ? (
                      <EmptyState
                        illustration="no-data"
                        title="Aucun problème disponible"
                        message="Aucun problème en cours pour cette agence (les problèmes dont la résolution est vérifiée ne sont pas proposés). Créez-en un nouveau."
                      />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                        {issuesExistantes.map((i) => (
                          <label
                            key={i.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '10px',
                              border: issueSelectionneeId === i.id ? '2px solid var(--color-encre)' : '1px solid var(--color-trait)',
                              cursor: 'pointer',
                              background: issueSelectionneeId === i.id ? 'var(--color-bon-fond)' : 'var(--color-surface)',
                            }}
                          >
                            <input
                              type="radio"
                              name="issue-existante"
                              checked={issueSelectionneeId === i.id}
                              onChange={() => setIssueSelectionneeId(i.id)}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="t-sm t-semi t-encre">{i.titre}</div>
                              <div className="t-xs t-2">
                                {ISSUE_STATUT_LABELS[i.statut]} · {ISSUE_SEVERITE_LABELS[i.severite]}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button type="button" onClick={() => setIssueMode('choix')} className="btn-secondary" style={{ padding: '6px 12px', borderRadius: '8px' }}>
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handleRattacherIssue}
                        disabled={loadingAction || !issueSelectionneeId}
                        className="btn-primary"
                        style={{ padding: '8px 16px', fontSize: 'var(--text-xs)', borderRadius: '10px', opacity: issueSelectionneeId ? 1 : 0.5, cursor: issueSelectionneeId ? 'pointer' : 'not-allowed' }}
                      >
                        {loadingAction ? 'Rattachement...' : 'Rattacher à ce problème'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* 6. Commentaires Internes (Main Courante) */}
              <div
                style={{
                  background: 'var(--color-surface)',
                  borderRadius: '18px',
                  padding: '18px 20px',
                  border: '1px solid var(--color-trait)',
                }}
              >
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Note interne
                </div>
                <form onSubmit={handleAddNote}>
                  <textarea
                    rows={2}
                    value={noteInterneInput}
                    onChange={(e) => setNoteInterneInput(e.target.value)}
                    placeholder="Ajouter une note interne (ex: Client joint par téléphone, confirmation de sa satisfaction)..."
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--color-trait)',
                      background: 'var(--color-bg)',
                      fontFamily: 'inherit',
                      fontSize: 'var(--text-sm)',
                      resize: 'none',
                      boxSizing: 'border-box',
                      marginBottom: '8px',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      disabled={loadingAction || !noteInterneInput.trim()}
                      className="btn-primary"
                      style={{
                        padding: '8px 14px',
                        borderRadius: '10px',
                        opacity: noteInterneInput.trim() ? 1 : 0.5,
                        cursor: noteInterneInput.trim() ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <PlusIcon size={13} />
                      <span>{loadingAction ? 'Enregistrement...' : 'Ajouter une note'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}

          {/* ONGLET 2 : HISTORIQUE CHRONOLOGIQUE COMPLET */}
          {activeTab === 'historique' && (
            <div>
              {historiqueList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-2)', fontStyle: 'italic', fontSize: 'var(--text-sm)' }}>
                  Aucun événement d'historique enregistré pour l'instant.
                </div>
              ) : (
                <div style={{ position: 'relative', paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Ligne verticale de timeline */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '7px',
                      top: '10px',
                      bottom: '10px',
                      width: '2px',
                      background: 'var(--color-neutre-fond)',
                    }}
                  />

                  {historiqueList.map((evt) => (
                    <div key={evt.id} style={{ position: 'relative' }}>
                      {/* Point sur la timeline */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '-24px',
                          top: '4px',
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          background: evt.type_evenement === 'action_realisee' ? 'var(--color-marque)' : evt.type_evenement === 'action_definie' ? 'var(--color-surveiller-texte)' : 'var(--color-encre)',
                          border: '3px solid var(--color-surface)',
                          boxShadow: '0 0 0 1px var(--color-trait)',
                        }}
                      />

                      {/* Carte d'événement */}
                      <div
                        style={{
                          background: 'var(--color-bg)',
                          borderRadius: '14px',
                          padding: '12px 16px',
                          border: '1px solid var(--color-trait)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong className="t-sm t-encre">{evt.auteur_nom}</strong>
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: 'var(--color-neutre-fond)',
                                color: 'var(--color-neutre-texte)',
                                fontWeight: 'var(--weight-semibold)',
                              }}
                            >
                              {ROLE_LABELS[evt.auteur_role as UserRole] ?? evt.auteur_role}
                            </span>
                          </div>
                          <span className="t-xs t-2">
                            {new Date(evt.date_evenement).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {evt.ancien_statut && evt.nouveau_statut && evt.ancien_statut !== evt.nouveau_statut && (
                          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', margin: '4px 0' }}>
                            Statut : <span>{AVIS_STATUT_LABELS[evt.ancien_statut as StatutTraitement] ?? evt.ancien_statut}</span> → <strong className="t-bon">{AVIS_STATUT_LABELS[evt.nouveau_statut as StatutTraitement] ?? evt.nouveau_statut}</strong>
                          </div>
                        )}

                        {evt.details && (
                          <p style={{ margin: '4px 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-encre)', lineHeight: 1.4 }}>
                            {evt.details}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ONGLET 3 : RÉPONSES ET ÉCHANGES CLIENT */}
          {activeTab === 'reponses' && (
            <div>
              {reponsesList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-2)', fontStyle: 'italic', fontSize: 'var(--text-sm)' }}>
                  Aucune réponse client enregistrée pour l'instant.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {reponsesList.map((rep) => (
                    <div
                      key={rep.id}
                      style={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-trait)',
                        borderRadius: '14px',
                        padding: '14px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong className="t-sm t-encre">{rep.auteur_nom}</strong>
                          <span style={{ fontSize: 'var(--text-xs)', background: 'var(--color-neutre-fond)', color: 'var(--color-neutre-texte)', padding: '2px 8px', borderRadius: '6px', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase' }}>
                            Par {(CANAL_LABELS as Record<string, string>)[rep.canal] ?? rep.canal}
                          </span>
                        </div>
                        <span className="t-xs t-2">
                          {new Date(rep.date_envoi).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-encre)', lineHeight: 1.5 }}>
                        "{rep.contenu}"
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Footer de la Modale ───────────────────────────────── */}
        <div
          style={{
            padding: '16px 28px',
            background: 'var(--color-bg)',
            borderTop: '1px solid var(--color-trait)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <button
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '10px 20px', fontSize: 'var(--text-sm)', borderRadius: '12px' }}
          >
            Fermer
          </button>

        </div>

      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Feedback, StatutTraitement, HistoriqueFeedback, ReponseClient, UserRole, Issue, IssueStatut, Categorie, CriticiteType } from '../../types';
import { feedbacksApi, issuesApi, agencesApi } from '../../services/api';
import { AVIS_STATUT_LABELS, GRAVITE_LABELS, PROBLEME_STATUT_LABELS, ROLE_LABELS, SENTIMENT_LABELS } from '../../utils/vocabulaire';
import { themeLabel } from '../../utils/themeLabels';
import EmptyState from '../ui/EmptyState';
import WhatsAppReplyButton from './WhatsAppReplyButton';
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

/** Canaux possibles d'une réponse au client — IKAN AI n'envoie rien lui-même. */
const CANAL_LABELS: Record<string, string> = {
  telephone: 'Téléphone',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  sms: 'SMS',
};

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

export default function FeedbackTreatmentModal({
  feedback,
  isOpen,
  onClose,
  onUpdateFeedback,
  currentUserRole = 'agency_manager',
  currentUserName = 'Utilisateur',
}: FeedbackTreatmentModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<'traitement' | 'historique' | 'reponses'>('traitement');
  
  // États locaux formulaires
  const [noteInterneInput, setNoteInterneInput] = useState('');
  const [suggestionInput, setSuggestionInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [reponseInput, setReponseInput] = useState('');
  const [reponseCanal, setReponseCanal] = useState<'telephone' | 'whatsapp' | 'email' | 'sms'>('telephone');
  const [showReponseForm, setShowReponseForm] = useState(false);

  // Données associées
  const [historiqueList, setHistoriqueList] = useState<HistoriqueFeedback[]>([]);
  const [reponsesList, setReponsesList] = useState<ReponseClient[]>([]);
  const [loadingAction, setLoadingAction] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Issue liée (créer / rattacher / détacher) ──────────
  const [issueLiee, setIssueLiee] = useState<Issue | null>(null);
  const [issueLieeLoading, setIssueLieeLoading] = useState(false);
  const [issueMode, setIssueMode] = useState<'choix' | 'creer' | 'rattacher'>('choix');

  const [categoriesAgence, setCategoriesAgence] = useState<Categorie[]>([]);
  const [creerTitre, setCreerTitre] = useState('');
  const [creerDescription, setCreerDescription] = useState('');
  const [creerSeverite, setCreerSeverite] = useState<CriticiteType | ''>('');
  const [creerCategorieId, setCreerCategorieId] = useState('');

  const [issuesExistantes, setIssuesExistantes] = useState<Issue[]>([]);
  const [issuesExistantesLoading, setIssuesExistantesLoading] = useState(false);
  const [issueSelectionneeId, setIssueSelectionneeId] = useState<string | null>(null);

  const isAgencyManager = currentUserRole === 'agency_manager';
  const isCXManager = currentUserRole === 'cx_manager' || currentUserRole === 'admin';

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

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

  // 1. Déclenchement automatique Nouveau -> En traitement à l'ouverture
  useEffect(() => {
    if (!isOpen || !feedback) return;
    // Le rétrécissement de type ne traverse pas la frontière de la fonction imbriquée : on capture la valeur non nulle.
    const fb = feedback;

    let isMounted = true;
    async function handleAutoOpen() {
      // Prise en charge réservée à l'Agency Manager (voir open_feedback, backend) : pour
      // le CX Manager, l'appel échouerait (403) — ne pas le déclencher.
      if (fb.statut_traitement === 'nouveau' && isAgencyManager) {
        try {
          const res = await feedbacksApi.open(fb.id);
          if (isMounted) {
            onUpdateFeedback(res.data);
            showToast('Avis pris en charge : il vous est désormais attribué');
          }
        } catch (err) {
          console.error('Erreur ouverture feedback:', err);
        }
      }
      if (isMounted) {
        loadHistoriqueAndReponses(fb.id);
      }
    }

    handleAutoOpen();

    // Reset des inputs
    setNoteInterneInput('');
    setSuggestionInput('');
    setActionInput(feedback.action_a_prendre || '');
    setReponseInput('');
    setShowReponseForm(false);
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

  // Raccourci touche Échap pour fermer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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
      showToast('✓ Suggestion transmise au CX Manager');
    } catch {
      showToast('Erreur lors de l’envoi de la suggestion');
    } finally {
      setLoadingAction(false);
    }
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
    } catch {
      showToast('Erreur lors de l’enregistrement de l’action');
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
    } catch {
      showToast('Erreur lors de la confirmation de l’action');
    } finally {
      setLoadingAction(false);
    }
  };

  // 5. Répondre au client
  const handleEnvoyerReponseClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reponseInput.trim()) return;
    setLoadingAction(true);
    try {
      const res = await feedbacksApi.envoyerReponseClient(feedback.id, reponseInput.trim(), reponseCanal);
      setReponsesList(res.data || []);
      setReponseInput('');
      setShowReponseForm(false);
      await loadHistoriqueAndReponses(feedback.id);
      showToast('Réponse au client enregistrée');
    } catch {
      showToast('Impossible d’enregistrer la réponse. Réessayez.');
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
    } catch {
      showToast('Erreur lors de la réouverture');
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
    try {
      const res = await issuesApi.list({ agence_id: feedback.agence_id });
      // Les Issues déjà vérifiées ne sont pas proposées ici : y rattacher un feedback les
      // rouvre automatiquement côté backend (comportement voulu, mais pas le premier choix).
      setIssuesExistantes((res.data || []).filter((i) => i.statut !== 'verifiee'));
    } catch {
      setIssuesExistantes([]);
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
        background: 'rgba(15, 23, 42, 0.65)',
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
          .feedback-treatment-tabs button { padding: 10px 12px !important; white-space: nowrap; }
          .feedback-treatment-body { padding: 16px !important; }
        }
      `}</style>

      {/* Conteneur Modale SaaS */}
      <div
        className="feedback-treatment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-treatment-title"
        tabIndex={-1}
        style={{
          width: '780px',
          maxWidth: '100%',
          maxHeight: 'min(92vh, 900px)',
          background: '#FFFFFF',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
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
            background: '#02302D',
            color: '#FFFFFF',
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
                  background: '#75B72A',
                  color: '#02302D',
                  fontWeight: 800,
                  fontSize: '0.72rem',
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Traitement de l’avis
              </span>
            </div>
            <h2 id="feedback-treatment-title" style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Avis #{feedback.id.slice(0, 8)}
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: '#FFFFFF',
              width: '44px',
              height: '44px',
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 700,
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
              background: '#3C7730',
              color: '#FFFFFF',
              padding: '10px 24px',
              fontSize: '0.84rem',
              fontWeight: 700,
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            {toastMessage}
          </div>
        )}

        {/* ── Workflow Stepper Informatif (Non-cliquable) ──────── */}
        <div
          className="feedback-treatment-stepper"
          style={{
            background: '#F8FAFC',
            padding: '16px 28px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {STEPPER_STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIdx || currentStatut === 'resolu';
            const isActive = idx === currentStepIdx && currentStatut !== 'resolu';
            const isFuture = idx > currentStepIdx;

            let dotBg = '#CBD5E1';
            let dotColor = '#64748B';
            let labelColor = '#64748B';
            let labelWeight = 500;

            if (isCompleted) {
              dotBg = '#3C7730';
              dotColor = '#FFFFFF';
              labelColor = '#02302D';
              labelWeight = 700;
            } else if (isActive) {
              dotBg = '#D97706';
              dotColor = '#FFFFFF';
              labelColor = '#B45309';
              labelWeight = 800;
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
                      fontSize: '0.72rem',
                      fontWeight: 800,
                    }}
                  >
                    {isCompleted ? '✓' : idx + 1}
                  </div>
                  <span style={{ fontSize: '0.82rem', color: labelColor, fontWeight: labelWeight }}>
                    {step.label}
                  </span>
                </div>
                {idx < STEPPER_STEPS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: '2px',
                      background: idx < currentStepIdx ? '#3C7730' : '#E2E8F0',
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
            background: '#FFFFFF',
            borderBottom: '1px solid #F1F5F9',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.82rem',
          }}
        >
          {/* Note */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#F8FAFC', padding: '4px 10px', borderRadius: '8px', border: '1px solid #E2E8F0', fontWeight: 700 }}>
            <span>Note :</span>
            <span style={{ color: '#F59E0B' }}>{'★'.repeat(feedback.note)}{'☆'.repeat(5 - feedback.note)}</span>
            <span style={{ color: '#64748B' }}>({feedback.note}/5)</span>
          </div>

          {/* Sentiment */}
          <div
            style={{
              padding: '4px 10px',
              borderRadius: '8px',
              fontWeight: 700,
              background: feedback.analyse_ia?.sentiment === 'positif' ? '#EBF5E9' : feedback.analyse_ia?.sentiment === 'negatif' ? '#FEE2E2' : '#FEF3C7',
              color: feedback.analyse_ia?.sentiment === 'positif' ? '#3C7730' : feedback.analyse_ia?.sentiment === 'negatif' ? '#B91C1C' : '#B45309',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            {feedback.analyse_ia?.sentiment === 'positif' && <ThumbsUpIcon size={12} color="#3C7730" />}
            {feedback.analyse_ia?.sentiment === 'negatif' && <ThumbsDownIcon size={12} color="#B91C1C" />}
            <span>Ton : {feedback.analyse_ia ? (feedback.analyse_ia.sentiment ? SENTIMENT_LABELS[feedback.analyse_ia.sentiment] ?? feedback.analyse_ia.sentiment : 'Non évalué') : 'Non analysé'}</span>
          </div>

          {/* Criticité : afficher uniquement l'analyse réelle et distinguer une valeur absente. */}
          <div style={{ background: feedback.analyse_ia?.criticite === 'critique' ? '#FEE2E2' : feedback.analyse_ia?.criticite === 'elevee' ? '#FFEDD5' : '#F8FAFC', color: feedback.analyse_ia?.criticite === 'critique' ? '#B91C1C' : feedback.analyse_ia?.criticite === 'elevee' ? '#C2410C' : '#475569', padding: '4px 10px', borderRadius: '8px', border: '1px solid #E2E8F0', fontWeight: 800 }}>
            Gravité : {feedback.analyse_ia ? (feedback.analyse_ia.criticite ? GRAVITE_LABELS[feedback.analyse_ia.criticite] ?? feedback.analyse_ia.criticite : 'Non évaluée') : 'Non analysé'}
          </div>
          {feedback.analyse_ia?.discordance_detectee && (
            <div role="status" style={{ background: '#FFF7ED', color: '#9A3412', padding: '4px 10px', borderRadius: '8px', border: '1px solid #FED7AA', fontWeight: 800 }}>
              <span title="La note donnée ne correspond pas au ton du commentaire (ex. 5/5 avec un commentaire négatif).">Note et commentaire contradictoires</span>
            </div>
          )}

          {/* Statut Badge */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: '#64748B', fontWeight: 600 }}>Statut :</span>
            <span
              style={{
                padding: '4px 12px',
                borderRadius: '9999px',
                fontWeight: 800,
                fontSize: '0.75rem',
                background: currentStatut === 'resolu' ? '#EBF5E9' : currentStatut === 'en_cours' ? '#FEF3C7' : currentStatut === 'en_traitement' ? '#E0F2FE' : '#FEE2E2',
                color: currentStatut === 'resolu' ? '#3C7730' : currentStatut === 'en_cours' ? '#D97706' : currentStatut === 'en_traitement' ? '#0369A1' : '#DC2626',
              }}
            >
              {AVIS_STATUT_LABELS[currentStatut] ?? AVIS_STATUT_LABELS.nouveau}
            </span>
          </div>
        </div>

        {/* ── Navigation Onglets ────────────────────────────────── */}
        <div className="feedback-treatment-tabs" style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', background: '#FAFAFA', padding: '0 28px' }}>
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
                  borderBottom: active ? '2px solid #02302D' : '2px solid transparent',
                  color: active ? '#02302D' : '#64748B',
                  fontWeight: active ? 800 : 600,
                  fontSize: '0.84rem',
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
                  background: '#F8FAFC',
                  borderRadius: '16px',
                  padding: '18px 20px',
                  border: '1px solid #E2E8F0',
                }}
              >
                <div style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 800, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  COMMENTAIRE DU CLIENT
                </div>
                <p style={{ margin: 0, fontSize: '0.94rem', color: '#0F172A', lineHeight: 1.55, fontStyle: feedback.commentaire ? 'normal' : 'italic' }}>
                  "{feedback.commentaire || 'Pas de commentaire écrit.'}"
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', padding: '0 2px', color: '#64748B', fontSize: '0.82rem' }} aria-label="Contexte de l’avis">
                <span><strong style={{ color: '#334155' }}>Agence :</strong> {feedback.agence_nom || 'Non renseignée'}</span>
                <span><strong style={{ color: '#334155' }}>Date :</strong> {new Date(feedback.date_soumission).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span><strong style={{ color: '#334155' }}>Thème :</strong> {feedback.analyse_ia?.theme_principal ? themeLabel(feedback.analyse_ia.theme_principal) : 'Non catégorisé'}</span>
                {feedback.assigne_a_nom && <span><strong style={{ color: '#334155' }}>Pris en charge par :</strong> {feedback.assigne_a_nom}</span>}
              </div>

              {/* 2. Feedback Positif Sans Action Requise */}
              {isPositiveFeedback && (
                <div
                  style={{
                    background: '#EBF6ED',
                    border: '1px solid #D6E8D9',
                    borderRadius: '16px',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    color: '#02302D',
                  }}
                >
                  <ThumbsUpIcon size={20} color="#3C7730" />
                  <div style={{ fontSize: '0.86rem', fontWeight: 700 }}>
                    Avis positif : aucune action à mener n’est nécessaire.
                  </div>
                </div>
              )}

              {/* 3. Informations Client & Module Répondre */}
              {feedback.demande_contact && (feedback.demande_contact.telephone || feedback.demande_contact.email || feedback.demande_contact.souhaite_etre_rappele) && (
                <div
                  style={{
                    background: '#FFF7ED',
                    border: '1px solid #FFEDD5',
                    borderRadius: '18px',
                    padding: '18px 20px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#C2410C', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <PhoneIcon size={15} color="#C2410C" />
                      <span>INFORMATIONS CLIENT</span>
                    </div>
                    {feedback.demande_contact.souhaite_etre_rappele && (
                      <span style={{ background: '#FEE2E2', color: '#B91C1C', padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700 }}>
                        Rappel souhaité
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '0.85rem', color: '#431407', display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '12px' }}>
                    {feedback.demande_contact.nom && <div><strong>Nom :</strong> {feedback.demande_contact.nom}</div>}
                    {feedback.demande_contact.telephone && (
                      <div>
                        <strong>Téléphone :</strong>{' '}
                        <a href={`tel:${feedback.demande_contact.telephone}`} style={{ color: '#C2410C', fontWeight: 700, textDecoration: 'none' }}>
                          {feedback.demande_contact.telephone}
                        </a>
                      </div>
                    )}
                    {feedback.demande_contact.email && (
                      <div>
                        <strong>E-mail :</strong>{' '}
                        <a href={`mailto:${feedback.demande_contact.email}`} style={{ color: '#C2410C', fontWeight: 700, textDecoration: 'none' }}>
                          {feedback.demande_contact.email}
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Réponse WhatsApp (Agency Manager uniquement) : ouvre wa.me, aucun envoi ni marquage « traitée ». */}
                  {isAgencyManager && (
                    <div style={{ marginBottom: '12px' }}>
                      <WhatsAppReplyButton
                        telephone={feedback.demande_contact.telephone}
                        telephoneWhatsapp={feedback.demande_contact.telephone_whatsapp}
                      />
                    </div>
                  )}

                  {/* Bouton pour afficher le formulaire de réponse */}
                  {!showReponseForm ? (
                    <button
                      onClick={() => setShowReponseForm(true)}
                      className="btn-primary"
                      style={{ padding: '8px 14px', fontSize: '0.8rem', borderRadius: '10px' }}
                    >
                      <MessageSquareIcon size={14} />
                      <span>Enregistrer une réponse au client</span>
                    </button>
                  ) : (
                    <form onSubmit={handleEnvoyerReponseClient} style={{ marginTop: '12px', background: '#FFFFFF', padding: '14px', borderRadius: '12px', border: '1px solid #FFEDD5' }}>
                      {/* POST /feedbacks/{id}/reponses enregistre la réponse : aucun message n'est envoyé au client. */}
                      <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: '#64748B', lineHeight: 1.5 }}>
                        IKAN AI n’envoie aucun message au client. Contactez-le par le canal choisi, puis notez ici ce que vous lui avez répondu.
                        L’enregistrement marque aussi la demande de rappel comme traitée.
                      </p>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        {(['telephone', 'whatsapp', 'email', 'sms'] as const).map((canal) => (
                          <button
                            key={canal}
                            type="button"
                            onClick={() => setReponseCanal(canal)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              border: reponseCanal === canal ? '2px solid #C2410C' : '1px solid #E2E8F0',
                              background: reponseCanal === canal ? '#FFF7ED' : '#FFFFFF',
                              color: reponseCanal === canal ? '#C2410C' : '#64748B',
                              textTransform: 'capitalize',
                            }}
                          >
                            {CANAL_LABELS[canal] ?? canal}
                          </button>
                        ))}
                      </div>
                      <textarea
                        rows={3}
                        value={reponseInput}
                        onChange={(e) => setReponseInput(e.target.value)}
                        placeholder="Ce que vous avez répondu au client (ex. : appelé ce jour, problème de facturation expliqué et corrigé)…"
                        style={{
                          width: '100%',
                          padding: '10px',
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                          fontSize: '0.84rem',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                          marginBottom: '8px',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setShowReponseForm(false)}
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: '8px' }}
                        >
                          Annuler
                        </button>
                        <button
                          type="submit"
                          disabled={loadingAction || !reponseInput.trim()}
                          className="btn-primary"
                          style={{
                            padding: '6px 14px',
                            fontSize: '0.78rem',
                            borderRadius: '8px',
                            opacity: reponseInput.trim() ? 1 : 0.5,
                            cursor: reponseInput.trim() ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <SendIcon size={12} />
                          <span>{loadingAction ? 'Enregistrement…' : 'Enregistrer la réponse'}</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* 4. WORKFLOW AGENCY MANAGER : Suggestion pour le CX */}
              {isAgencyManager && (
                <div
                  style={{
                    background: '#F8FAFC',
                    borderRadius: '18px',
                    padding: '18px 20px',
                    border: '1px solid #E2E8F0',
                  }}
                >
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#02302D', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Suggestion pour le CX Manager
                  </div>
                  <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '0 0 12px 0' }}>
                    Proposez une solution ou une amélioration terrain au CX Manager. L’avis restera « Pris en charge » jusqu’à ce qu’une action soit définie.
                  </p>

                  {feedback.suggestion_agence ? (
                    <div style={{ background: '#EBF6ED', border: '1px solid #D6E8D9', borderRadius: '12px', padding: '12px 14px', color: '#02302D', fontSize: '0.86rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, marginBottom: '4px', color: '#3C7730' }}>
                        <CheckIcon size={14} />
                        <span>Suggestion transmise au CX Manager</span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontStyle: 'italic' }}>"{feedback.suggestion_agence}"</p>
                      {feedback.suggestion_agence_auteur && (
                        <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '6px' }}>
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
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          fontFamily: 'inherit',
                          fontSize: '0.86rem',
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
                          fontSize: '0.82rem',
                          borderRadius: '12px',
                          opacity: suggestionInput.trim() ? 1 : 0.5,
                          cursor: suggestionInput.trim() ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <SendIcon size={13} />
                        <span>{loadingAction ? 'Envoi en cours...' : 'Envoyer la suggestion au CX Manager'}</span>
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
                        background: '#EFF6FF',
                        border: '1px solid #BFDBFE',
                        borderRadius: '18px',
                        padding: '16px 20px',
                      }}
                    >
                      <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1E40AF', marginBottom: '6px', textTransform: 'uppercase' }}>
                        SUGGESTION DE L'AGENCE ({feedback.agence_nom || 'Agence'})
                      </div>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', fontStyle: 'italic', lineHeight: 1.5 }}>
                        "{feedback.suggestion_agence}"
                      </p>
                      {feedback.suggestion_agence_auteur && (
                        <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '6px' }}>
                          Soumis par {feedback.suggestion_agence_auteur}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Définition ou Confirmation d'Action Corrective */}
                  <div
                    style={{
                      background: '#F8FAFC',
                      borderRadius: '18px',
                      padding: '18px 20px',
                      border: '1px solid #E2E8F0',
                    }}
                  >
                    <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#02302D', marginBottom: '8px', textTransform: 'uppercase' }}>
                      ACTION À MENER (DÉFINIE PAR LE CX MANAGER)
                    </div>

                    {currentStatut === 'en_traitement' && (
                      <form onSubmit={handleDefinirActionCX}>
                        <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '0 0 10px 0' }}>
                          Décrivez l’action à mener. Dès l’enregistrement, le statut passera à <strong>« Action en cours »</strong>.
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
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            fontFamily: 'inherit',
                            fontSize: '0.86rem',
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
                            fontSize: '0.82rem',
                            borderRadius: '12px',
                            opacity: actionInput.trim() ? 1 : 0.5,
                            cursor: actionInput.trim() ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <PlusIcon size={14} />
                          <span>{loadingAction ? 'Enregistrement...' : 'Enregistrer l’action à mener'}</span>
                        </button>
                      </form>
                    )}

                    {currentStatut === 'en_cours' && (
                      <div>
                        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '12px', padding: '12px 14px', marginBottom: '14px' }}>
                          <div style={{ fontSize: '0.78rem', color: '#92400E', fontWeight: 800 }}>ACTION À MENER (PAS ENCORE CONFIRMÉE) :</div>
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#78350F', fontWeight: 600 }}>
                            "{feedback.action_a_prendre || actionInput}"
                          </p>
                        </div>
                        <button
                          onClick={handleConfirmerActionRealisee}
                          disabled={loadingAction}
                          className="btn-primary"
                          style={{ width: '100%', padding: '12px', fontWeight: 800, fontSize: '0.86rem', justifyContent: 'center' }}
                        >
                          <CheckCircleIcon size={16} />
                          <span>{loadingAction ? 'Validation en cours...' : 'Confirmer l’action réalisée → Résoudre l’avis'}</span>
                        </button>
                      </div>
                    )}

                    {currentStatut === 'resolu' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#EBF6ED', border: '1px solid #D6E8D9', borderRadius: '12px', padding: '14px 16px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3C7730', fontWeight: 800, fontSize: '0.88rem' }}>
                            <CheckCircleIcon size={16} />
                            <span>Avis marqué comme résolu</span>
                          </div>
                          {feedback.action_a_prendre && (
                            <div style={{ fontSize: '0.82rem', color: '#02302D', marginTop: '4px' }}>
                              Action réalisée : "{feedback.action_a_prendre}"
                            </div>
                          )}
                        </div>
                        <button
                          onClick={handleReouvrir}
                          disabled={loadingAction}
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.76rem', borderRadius: '8px' }}
                        >
                          <RefreshIcon size={12} />
                          <span>Rouvrir</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 5bis. ISSUE LIÉE (CX Manager & Agency Manager) — créer, rattacher ou détacher */}
              <div
                style={{
                  background: '#FFFFFF',
                  borderRadius: '18px',
                  padding: '18px 20px',
                  border: '1px solid #E2E8F0',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#02302D', marginBottom: '10px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <TargetIcon size={15} color="#02302D" />
                  <span>Problème à traiter lié</span>
                </div>

                {issueLieeLoading ? (
                  <div style={{ fontSize: '0.84rem', color: '#64748B' }}>Chargement...</div>
                ) : feedback.issue_id ? (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ fontSize: '0.86rem', color: '#02302D' }}>
                      Rattaché au problème : <strong>{issueLiee?.titre || '…'}</strong>
                      {issueLiee && (
                        <span style={{ marginLeft: '8px', fontSize: '0.74rem', color: '#64748B', fontWeight: 600 }}>
                          ({ISSUE_STATUT_LABELS[issueLiee.statut]} · {ISSUE_SEVERITE_LABELS[issueLiee.severite]})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleDetacherIssue}
                      disabled={loadingAction}
                      style={{ background: '#FFFFFF', color: '#DC2626', border: '1px solid #FEE2E2', borderRadius: '10px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
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
                      style={{ padding: '8px 14px', fontSize: '0.8rem', borderRadius: '10px' }}
                    >
                      <PlusIcon size={13} />
                      <span>Créer un nouveau problème</span>
                    </button>
                    <button
                      type="button"
                      onClick={ouvrirRattachement}
                      className="btn-secondary"
                      style={{ padding: '8px 14px', fontSize: '0.8rem', borderRadius: '10px' }}
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
                      style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.86rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <textarea
                      rows={2}
                      value={creerDescription}
                      onChange={(e) => setCreerDescription(e.target.value)}
                      placeholder="Description (optionnelle)"
                      style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.86rem', fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <select
                        value={creerSeverite}
                        onChange={(e) => setCreerSeverite(e.target.value as CriticiteType)}
                        required
                        style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.82rem', fontFamily: 'inherit' }}
                      >
                        <option value="">Choisir la gravité</option>
                        {(Object.keys(ISSUE_SEVERITE_LABELS) as CriticiteType[]).map((s) => (
                          <option key={s} value={s}>{ISSUE_SEVERITE_LABELS[s]}</option>
                        ))}
                      </select>
                      <select
                        value={creerCategorieId}
                        onChange={(e) => setCreerCategorieId(e.target.value)}
                        style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.82rem', fontFamily: 'inherit', minWidth: '160px' }}
                      >
                        <option value="">Sans catégorie</option>
                        {categoriesAgence.map((c) => (
                          <option key={c.id} value={c.id}>{c.nom}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button type="button" onClick={() => setIssueMode('choix')} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: '8px' }}>
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={loadingAction || !creerTitre.trim() || !creerSeverite}
                        className="btn-primary"
                        style={{ padding: '8px 16px', fontSize: '0.8rem', borderRadius: '10px', opacity: creerTitre.trim() && creerSeverite ? 1 : 0.5, cursor: creerTitre.trim() && creerSeverite ? 'pointer' : 'not-allowed' }}
                      >
                        {loadingAction ? 'Création...' : 'Créer le problème'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {issuesExistantesLoading ? (
                      <div style={{ fontSize: '0.84rem', color: '#64748B' }}>Chargement des problèmes…</div>
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
                              border: issueSelectionneeId === i.id ? '2px solid #3C7730' : '1px solid #E2E8F0',
                              cursor: 'pointer',
                              background: issueSelectionneeId === i.id ? '#EBF5E9' : '#FFFFFF',
                            }}
                          >
                            <input
                              type="radio"
                              name="issue-existante"
                              checked={issueSelectionneeId === i.id}
                              onChange={() => setIssueSelectionneeId(i.id)}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#02302D' }}>{i.titre}</div>
                              <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                                {ISSUE_STATUT_LABELS[i.statut]} · {ISSUE_SEVERITE_LABELS[i.severite]}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button type="button" onClick={() => setIssueMode('choix')} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: '8px' }}>
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handleRattacherIssue}
                        disabled={loadingAction || !issueSelectionneeId}
                        className="btn-primary"
                        style={{ padding: '8px 16px', fontSize: '0.8rem', borderRadius: '10px', opacity: issueSelectionneeId ? 1 : 0.5, cursor: issueSelectionneeId ? 'pointer' : 'not-allowed' }}
                      >
                        {loadingAction ? 'Rattachement...' : 'Rattacher à ce problème'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 6. Commentaires Internes (Main Courante) */}
              <div
                style={{
                  background: '#FFFFFF',
                  borderRadius: '18px',
                  padding: '18px 20px',
                  border: '1px solid #E2E8F0',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#02302D', marginBottom: '8px', textTransform: 'uppercase' }}>
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
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      fontFamily: 'inherit',
                      fontSize: '0.85rem',
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
                        fontSize: '0.8rem',
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
                <div style={{ textAlign: 'center', padding: '32px', color: '#64748B', fontStyle: 'italic', fontSize: '0.86rem' }}>
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
                      background: '#E2E8F0',
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
                          background: evt.type_evenement === 'action_realisee' ? '#3C7730' : evt.type_evenement === 'action_definie' ? '#D97706' : '#02302D',
                          border: '3px solid #FFFFFF',
                          boxShadow: '0 0 0 1px #CBD5E1',
                        }}
                      />

                      {/* Carte d'événement */}
                      <div
                        style={{
                          background: '#F8FAFC',
                          borderRadius: '14px',
                          padding: '12px 16px',
                          border: '1px solid #E2E8F0',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '0.84rem', color: '#0F172A' }}>{evt.auteur_nom}</strong>
                            <span
                              style={{
                                fontSize: '0.7rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: evt.auteur_role === 'cx_manager' ? '#F3E8FF' : '#E0F2FE',
                                color: evt.auteur_role === 'cx_manager' ? '#7C3AED' : '#0369A1',
                                fontWeight: 700,
                              }}
                            >
                              {ROLE_LABELS[evt.auteur_role as UserRole] ?? evt.auteur_role}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.74rem', color: '#64748B' }}>
                            {new Date(evt.date_evenement).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {evt.ancien_statut && evt.nouveau_statut && evt.ancien_statut !== evt.nouveau_statut && (
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#02302D', margin: '4px 0' }}>
                            Statut : <span>{AVIS_STATUT_LABELS[evt.ancien_statut as StatutTraitement] ?? evt.ancien_statut}</span> → <strong style={{ color: '#3C7730' }}>{AVIS_STATUT_LABELS[evt.nouveau_statut as StatutTraitement] ?? evt.nouveau_statut}</strong>
                          </div>
                        )}

                        {evt.details && (
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.84rem', color: '#334155', lineHeight: 1.4 }}>
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
                <div style={{ textAlign: 'center', padding: '32px', color: '#64748B', fontStyle: 'italic', fontSize: '0.86rem' }}>
                  Aucune réponse client enregistrée pour l'instant.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {reponsesList.map((rep) => (
                    <div
                      key={rep.id}
                      style={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '14px',
                        padding: '14px 16px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '0.84rem', color: '#02302D' }}>{rep.auteur_nom}</strong>
                          <span style={{ fontSize: '0.72rem', background: '#FFF7ED', color: '#C2410C', padding: '2px 8px', borderRadius: '6px', fontWeight: 700, textTransform: 'uppercase' }}>
                            Par {CANAL_LABELS[rep.canal] ?? rep.canal}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.74rem', color: '#64748B' }}>
                          {new Date(rep.date_envoi).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5 }}>
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
            background: '#F8FAFC',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <button
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '10px 20px', fontSize: '0.84rem', borderRadius: '12px' }}
          >
            Fermer
          </button>

          <div style={{ fontSize: '0.8rem', color: '#64748B' }}>
            Statut : <strong style={{ color: '#02302D', textTransform: 'capitalize' }}>{currentStatut}</strong>
          </div>
        </div>

      </div>
    </div>
  );
}

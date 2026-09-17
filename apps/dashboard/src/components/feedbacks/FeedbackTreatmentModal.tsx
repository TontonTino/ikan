import React, { useState, useEffect, useCallback } from 'react';
import type { Feedback, StatutTraitement, HistoriqueFeedback, ReponseClient, UserRole } from '../../types';
import { feedbacksApi } from '../../services/api';
import {
  AlertTriangleIcon,
  ClockIcon,
  PhoneIcon,
  CheckCircleIcon,
  MapPinIcon,
  PlusIcon,
  UsersIcon,
  CheckIcon,
  MessageSquareIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  SendIcon,
  RefreshIcon,
} from '../common/Icons';

interface FeedbackTreatmentModalProps {
  feedback: Feedback | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateFeedback: (updatedFeedback: Feedback) => void;
  currentUserRole?: UserRole;
  currentUserName?: string;
}

const THEME_LABELS: Record<string, string> = {
  attente: 'Attente & Délais en caisse',
  accueil: 'Accueil & Conseillers',
  disponibilite_accessibilite: 'Accessibilité & Horaires',
  tarifs: 'Tarifs & Frais',
  qualite_produit: 'Qualité Produit & Forfaits',
  proprete_cadre: 'Propreté & Cadre agence',
  application_mobile: 'Application Mobile & E-espace',
  reseau: 'Réseau 4G/5G & Connexion',
  facturation: 'Facturation & Prélèvements',
  communication_information: 'Communication & Conseils',
  livraison_logistique: 'Livraison & Disponibilité SIM',
  resolution_probleme: 'SAV & Résolution',
  securite_confidentialite: 'Sécurité & Confidentialité',
  disponibilite_produit: 'Disponibilité Stocks / Terminaux',
  personnalisation_besoin: 'Écoute & Personnalisation',
};

const STEPPER_STEPS = [
  { key: 'nouveau', label: 'Nouveau' },
  { key: 'en_traitement', label: 'En traitement' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'resolu', label: 'Résolu' },
];

export default function FeedbackTreatmentModal({
  feedback,
  isOpen,
  onClose,
  onUpdateFeedback,
  currentUserRole = 'agency_manager',
  currentUserName = 'Utilisateur',
}: FeedbackTreatmentModalProps) {
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

  const isAgencyManager = currentUserRole === 'agency_manager';
  const isCXManager = currentUserRole === 'cx_manager' || currentUserRole === 'admin';

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

  // 1. Déclenchement automatique Nouveau -> En traitement à l'ouverture
  useEffect(() => {
    if (!isOpen || !feedback) return;

    let isMounted = true;
    async function handleAutoOpen() {
      if (feedback.statut_traitement === 'nouveau') {
        try {
          const res = await feedbacksApi.open(feedback.id);
          if (isMounted) {
            onUpdateFeedback(res.data);
            showToast('Feedback pris en charge : Nouveau → En traitement');
          }
        } catch (err) {
          console.error('Erreur ouverture feedback:', err);
        }
      }
      if (isMounted) {
        loadHistoriqueAndReponses(feedback.id);
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
  const isPositiveFeedback = feedback.note >= 4 && (!feedback.analyse_ia || feedback.analyse_ia.sentiment === 'positif') && !feedback.demande_contact?.souhaite_etre_rappele;

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
      showToast('Action enregistrée : Statut passé à "En cours"');
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
      showToast('✓ Action confirmée : Feedback résolu avec succès');
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
      showToast('Réponse client envoyée et enregistrée');
    } catch {
      showToast('Erreur lors de l’envoi de la réponse');
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
      showToast('Feedback rouvert : Statut passé à "En traitement"');
    } catch {
      showToast('Erreur lors de la réouverture');
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
      `}</style>

      {/* Conteneur Modale SaaS */}
      <div
        style={{
          width: '780px',
          maxWidth: '100%',
          maxHeight: '92vh',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
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
                Traitement Feedback
              </span>
              {feedback.agence_nom && (
                <span style={{ fontSize: '0.82rem', color: '#D6E8D9', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <MapPinIcon size={13} color="#BCCF00" />
                  <span>{feedback.agence_nom}</span>
                </span>
              )}
            </div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Feedback #{feedback.id.slice(0, 8)}
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '4px' }}>
              Soumis le {new Date(feedback.date_soumission).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {feedback.assigne_a_nom && <span> • Pris en charge par <strong style={{ color: '#FFFFFF' }}>{feedback.assigne_a_nom}</strong></span>}
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: '#FFFFFF',
              width: '34px',
              height: '34px',
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
            <span style={{ textTransform: 'capitalize' }}>Ressenti : {feedback.analyse_ia?.sentiment || 'Neutre'}</span>
          </div>

          {/* Thème IA */}
          <div style={{ background: '#F1F5F9', color: '#334155', padding: '4px 10px', borderRadius: '8px', fontWeight: 700 }}>
            Thème : {THEME_LABELS[feedback.analyse_ia?.theme_principal || ''] || feedback.analyse_ia?.theme_principal || 'Accueil & Conseillers'}
          </div>

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
              {currentStatut === 'resolu' ? 'Résolu' : currentStatut === 'en_cours' ? 'En cours' : currentStatut === 'en_traitement' ? 'En traitement' : 'Nouveau'}
            </span>
          </div>
        </div>

        {/* ── Navigation Onglets ────────────────────────────────── */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', background: '#FAFAFA', padding: '0 28px' }}>
          {[
            { id: 'traitement', label: 'Traitement Opérationnel', icon: <ClockIcon size={14} /> },
            { id: 'historique', label: `Historique (${historiqueList.length})`, icon: <UsersIcon size={14} /> },
            { id: 'reponses', label: `Réponses Client (${reponsesList.length})`, icon: <MessageSquareIcon size={14} /> },
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
        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

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
                  "{feedback.commentaire || 'Aucun commentaire texte rédigé.'}"
                </p>
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
                    Feedback positif — aucune action corrective requise sur ce retour client.
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
                        <strong>Email :</strong>{' '}
                        <a href={`mailto:${feedback.demande_contact.email}`} style={{ color: '#C2410C', fontWeight: 700, textDecoration: 'none' }}>
                          {feedback.demande_contact.email}
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Bouton pour afficher le formulaire de réponse */}
                  {!showReponseForm ? (
                    <button
                      onClick={() => setShowReponseForm(true)}
                      style={{
                        padding: '8px 14px',
                        background: '#C2410C',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <MessageSquareIcon size={14} />
                      <span>Répondre au client</span>
                    </button>
                  ) : (
                    <form onSubmit={handleEnvoyerReponseClient} style={{ marginTop: '12px', background: '#FFFFFF', padding: '14px', borderRadius: '12px', border: '1px solid #FFEDD5' }}>
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
                            {canal}
                          </button>
                        ))}
                      </div>
                      <textarea
                        rows={3}
                        value={reponseInput}
                        onChange={(e) => setReponseInput(e.target.value)}
                        placeholder="Rédigez la réponse client (ex: Bonjour, nous avons bien pris en compte votre remarque et vous informons que...)"
                        style={{
                          width: '100%',
                          padding: '10px',
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                          fontSize: '0.84rem',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                          marginBottom: '8px',
                          outline: 'none',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setShowReponseForm(false)}
                          style={{ padding: '6px 12px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Annuler
                        </button>
                        <button
                          type="submit"
                          disabled={loadingAction || !reponseInput.trim()}
                          style={{
                            padding: '6px 14px',
                            background: '#C2410C',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: reponseInput.trim() ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                          }}
                        >
                          <SendIcon size={12} />
                          <span>{loadingAction ? 'Envoi...' : 'Envoyer la réponse'}</span>
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
                    Proposez une solution ou une amélioration terrain au CX Manager. Le feedback restera "En traitement" jusqu'à validation de l'action.
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
                          outline: 'none',
                          resize: 'none',
                          boxSizing: 'border-box',
                          marginBottom: '10px',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={loadingAction || !suggestionInput.trim()}
                        style={{
                          padding: '10px 18px',
                          background: suggestionInput.trim() ? '#02302D' : '#94A3B8',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '12px',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          cursor: suggestionInput.trim() ? 'pointer' : 'not-allowed',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <SendIcon size={13} />
                        <span>{loadingAction ? 'Envoi en cours...' : 'Envoyer la suggestion au CX'}</span>
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
                      ACTION CORRECTIVE DU CX MANAGER
                    </div>

                    {currentStatut === 'en_traitement' && (
                      <form onSubmit={handleDefinirActionCX}>
                        <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '0 0 10px 0' }}>
                          Définissez l'action corrective. Dès l'enregistrement, le statut passera automatiquement à <strong>"En cours"</strong>.
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
                            outline: 'none',
                            resize: 'none',
                            boxSizing: 'border-box',
                            marginBottom: '10px',
                          }}
                        />
                        <button
                          type="submit"
                          disabled={loadingAction || !actionInput.trim()}
                          style={{
                            padding: '10px 18px',
                            background: actionInput.trim() ? '#D97706' : '#94A3B8',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '12px',
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            cursor: actionInput.trim() ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <PlusIcon size={14} />
                          <span>{loadingAction ? 'Enregistrement...' : 'Enregistrer l’action (Passer en cours)'}</span>
                        </button>
                      </form>
                    )}

                    {currentStatut === 'en_cours' && (
                      <div>
                        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '12px', padding: '12px 14px', marginBottom: '14px' }}>
                          <div style={{ fontSize: '0.78rem', color: '#92400E', fontWeight: 800 }}>ACTION EN COURS D’EXÉCUTION :</div>
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#78350F', fontWeight: 600 }}>
                            "{feedback.action_a_prendre || actionInput}"
                          </p>
                        </div>
                        <button
                          onClick={handleConfirmerActionRealisee}
                          disabled={loadingAction}
                          style={{
                            width: '100%',
                            padding: '12px',
                            background: '#3C7730',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '12px',
                            fontWeight: 800,
                            fontSize: '0.86rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 12px rgba(60, 119, 48, 0.25)',
                          }}
                        >
                          <CheckCircleIcon size={16} />
                          <span>{loadingAction ? 'Validation en cours...' : 'Confirmer l’action réalisée → Résoudre le feedback'}</span>
                        </button>
                      </div>
                    )}

                    {currentStatut === 'resolu' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#EBF6ED', border: '1px solid #D6E8D9', borderRadius: '12px', padding: '14px 16px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3C7730', fontWeight: 800, fontSize: '0.88rem' }}>
                            <CheckCircleIcon size={16} />
                            <span>Feedback Résolu avec succès</span>
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
                          style={{
                            padding: '6px 12px',
                            background: '#FFFFFF',
                            border: '1px solid #CBD5E1',
                            borderRadius: '8px',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            color: '#475569',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <RefreshIcon size={12} />
                          <span>Rouvrir</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                  Commentaire Interne (Main Courante)
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
                      outline: 'none',
                      resize: 'none',
                      boxSizing: 'border-box',
                      marginBottom: '8px',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      disabled={loadingAction || !noteInterneInput.trim()}
                      style={{
                        padding: '8px 14px',
                        background: noteInterneInput.trim() ? '#02302D' : '#94A3B8',
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: noteInterneInput.trim() ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
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
                              {evt.auteur_role === 'cx_manager' ? 'CX Manager' : evt.auteur_role === 'agency_manager' ? 'Agency Manager' : evt.auteur_role}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.74rem', color: '#64748B' }}>
                            {new Date(evt.date_evenement).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {evt.ancien_statut && evt.nouveau_statut && evt.ancien_statut !== evt.nouveau_statut && (
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#02302D', margin: '4px 0' }}>
                            Transition : <span style={{ textTransform: 'capitalize' }}>{evt.ancien_statut}</span> → <strong style={{ color: '#3C7730', textTransform: 'capitalize' }}>{evt.nouveau_statut}</strong>
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
                            Via {rep.canal}
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
            style={{
              padding: '10px 20px',
              background: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '12px',
              fontSize: '0.84rem',
              fontWeight: 700,
              color: '#334155',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
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

import React, { useState, useEffect } from 'react';
import type { Feedback, StatutTraitement, UserRole } from '../../types';
import { feedbacksApi } from '../../services/api';
import {
  AlertTriangleIcon,
  ClockIcon,
  PhoneIcon,
  CheckCircleIcon,
  MapPinIcon,
  LightningIcon,
  PlusIcon,
  UsersIcon,
  CheckIcon,
} from '../common/Icons';

interface FeedbackTreatmentDrawerProps {
  feedback: Feedback | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateFeedback: (updatedFeedback: Feedback) => void;
  currentUserRole?: UserRole;
  currentUserName?: string;
}

const STATUT_CONFIG: Record<StatutTraitement, { label: string; bg: string; color: string; icon: React.ReactNode }> = {
  nouveau: { label: 'Nouveau', bg: '#FEE2E2', color: '#DC2626', icon: <AlertTriangleIcon size={12} color="#DC2626" /> },
  en_cours: { label: 'En cours', bg: '#FEF3C7', color: '#D97706', icon: <ClockIcon size={12} color="#D97706" /> },
  recontacte: { label: 'Recontacté', bg: '#E0F2FE', color: '#0369A1', icon: <PhoneIcon size={12} color="#0369A1" /> },
  resolu: { label: 'Résolu', bg: '#EBF5E9', color: '#3C7730', icon: <CheckCircleIcon size={12} color="#3C7730" /> },
  escalade: { label: 'Escaladé Siège', bg: '#F3E8FF', color: '#7C3AED', icon: <AlertTriangleIcon size={12} color="#7C3AED" /> },
};

export default function FeedbackTreatmentDrawer({
  feedback,
  isOpen,
  onClose,
  onUpdateFeedback,
  currentUserRole,
  currentUserName,
}: FeedbackTreatmentDrawerProps) {
  const [noteInput, setNoteInput] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [updatingStatut, setUpdatingStatut] = useState(false);
  const [updatingDiscordance, setUpdatingDiscordance] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    setNoteInput('');
    setToastMessage(null);
  }, [feedback?.id]);

  if (!isOpen || !feedback) return null;

  const currentStatut: StatutTraitement = feedback.statut_traitement || 'nouveau';
  const notesInternes = feedback.notes_internes || [];
  const discordanceStatus = feedback.discordance_status;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 1. Changement de statut
  const handleStatutChange = async (newStatut: StatutTraitement) => {
    if (newStatut === currentStatut) return;
    setUpdatingStatut(true);
    try {
      await feedbacksApi.updateStatut(feedback.id, newStatut);
      const updated: Feedback = {
        ...feedback,
        statut_traitement: newStatut,
      };
      onUpdateFeedback(updated);
      showToast(`Statut modifié : ${STATUT_CONFIG[newStatut].label}`);
    } catch {
      showToast('Erreur lors du changement de statut');
    } finally {
      setUpdatingStatut(false);
    }
  };

  // 2. Traitement demande de contact
  const handleTraiterContact = async () => {
    if (!feedback.demande_contact?.id) return;
    try {
      await feedbacksApi.traiterDemandeContact(feedback.demande_contact.id);
      await feedbacksApi.updateStatut(feedback.id, 'recontacte');
      const updated: Feedback = {
        ...feedback,
        statut_traitement: 'recontacte',
        demande_contact: {
          ...feedback.demande_contact,
          traitee: true,
        },
      };
      onUpdateFeedback(updated);
      showToast('Demande marquée comme recontactée');
    } catch {
      showToast('Erreur de mise à jour du rappel');
    }
  };

  // 3. Ajout de note interne
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await feedbacksApi.addNoteInterne(feedback.id, noteInput, currentUserName);
      const addedNote = res.data?.note || {
        id: `note-${Date.now()}`,
        date: new Date().toISOString(),
        auteur: currentUserName || 'Agent',
        texte: noteInput.trim(),
      };
      const nextStatut: StatutTraitement = res.data?.statut || (currentStatut === 'nouveau' ? 'en_cours' : currentStatut);

      const updated: Feedback = {
        ...feedback,
        statut_traitement: nextStatut,
        notes_internes: [addedNote, ...notesInternes],
      };
      onUpdateFeedback(updated);
      setNoteInput('');
      showToast('Note interne enregistrée');
    } catch {
      showToast("Erreur lors de l'ajout de la note");
    } finally {
      setSubmittingNote(false);
    }
  };

  // 4. Gestion de discordance
  const handleUpdateDiscordance = async (statusVal: 'confirmee' | 'traitee_faux_positif') => {
    setUpdatingDiscordance(true);
    try {
      await feedbacksApi.updateDiscordance(feedback.id, statusVal);
      const updated: Feedback = {
        ...feedback,
        discordance_status: statusVal,
      };
      onUpdateFeedback(updated);
      showToast(statusVal === 'confirmee' ? 'Discordance confirmée' : 'Marqué comme faux positif');
    } catch {
      showToast('Erreur mise à jour discordance');
    } finally {
      setUpdatingDiscordance(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 1000,
      display: 'flex',
      justifyContent: 'flex-end',
      background: 'rgba(15, 23, 42, 0.45)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
    }}>
      {/* Clic hors-zone pour fermer */}
      <div style={{ flex: 1 }} onClick={onClose} />

      {/* Pane Principal du Drawer */}
      <div style={{
        width: '520px',
        maxWidth: '92vw',
        height: '100%',
        background: '#FFFFFF',
        boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '28px 0 0 28px',
        overflow: 'hidden',
        animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>

        {/* Header Vert Sombre `#02302D` */}
        <div style={{
          background: '#02302D',
          color: '#FFFFFF',
          padding: '24px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <span style={{
                background: '#75B72A',
                color: '#02302D',
                fontWeight: 800,
                fontSize: '0.75rem',
                padding: '3px 10px',
                borderRadius: '9999px',
                textTransform: 'uppercase',
              }}>
                Cellule de Traitement
              </span>
              {feedback.agence_nom && (
                <span style={{ fontSize: '0.8rem', opacity: 0.85, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <MapPinIcon size={13} color="#BCCF00" />
                  <span>{feedback.agence_nom}</span>
                </span>
              )}
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
              Feedback #{feedback.id.slice(0, 8)}
            </h2>
            <div style={{ fontSize: '0.88rem', color: '#BCCF00', marginTop: '4px', fontWeight: 700, textTransform: 'capitalize' }}>
              Ressenti client : {feedback.analyse_ia?.sentiment || 'Neutre'}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              color: 'white',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: '1.1rem',
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

        {/* Message Toast de notification */}
        {toastMessage && (
          <div style={{
            background: '#02302D',
            color: '#FFFFFF',
            padding: '10px 20px',
            fontSize: '0.85rem',
            fontWeight: 700,
            textAlign: 'center',
          }}>
            {toastMessage}
          </div>
        )}

        {/* Corps de défilement du Drawer */}
        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>
          
          {/* 1. Commentaire Client Original */}
          <div style={{
            background: 'var(--color-bg-alt)',
            borderRadius: '18px',
            padding: '18px 20px',
            marginBottom: '24px',
            border: '1px solid var(--color-border)',
          }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 700, marginBottom: '6px' }}>
              COMMENTAIRE DU CLIENT
            </div>
            <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--color-text)', lineHeight: 1.5, fontStyle: feedback.commentaire ? 'normal' : 'italic' }}>
              "{feedback.commentaire || 'Aucun commentaire écrit fourni.'}"
            </p>
          </div>

          {/* 2. Workflow de Statut */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: 'var(--color-text-muted)', marginBottom: '10px', textTransform: 'uppercase' }}>
              Statut du Traitement (Workflow Closed-Loop)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(Object.keys(STATUT_CONFIG) as StatutTraitement[]).map((st) => {
                const conf = STATUT_CONFIG[st];
                const isSelected = currentStatut === st;
                return (
                  <button
                    key={st}
                    onClick={() => handleStatutChange(st)}
                    disabled={updatingStatut}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '14px',
                      border: isSelected ? `2px solid ${conf.color}` : '1px solid var(--color-border)',
                      background: isSelected ? conf.bg : '#FFFFFF',
                      color: conf.color,
                      fontWeight: isSelected ? 800 : 600,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s',
                      boxShadow: isSelected ? '0 3px 10px rgba(0,0,0,0.06)' : 'none',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center' }}>{conf.icon}</span>
                    <span>{conf.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Module Demande de Rappel Client (si présente) */}
          {feedback.demande_contact && (
            <div style={{
              background: '#FFF7ED',
              border: '1px solid #FFEDD5',
              borderRadius: '20px',
              padding: '18px 20px',
              marginBottom: '24px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#C2410C', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PhoneIcon size={16} color="#C2410C" />
                  <span>Demande de Rappel Client</span>
                </div>
                <span className={`badge ${feedback.demande_contact.traitee ? 'badge-success' : 'badge-warning'}`}>
                  {feedback.demande_contact.traitee ? 'Recontacté' : 'En attente'}
                </span>
              </div>

              <div style={{ fontSize: '0.85rem', color: '#431407', marginBottom: '14px', lineHeight: 1.6 }}>
                {feedback.demande_contact.nom && <div><strong>Nom :</strong> {feedback.demande_contact.nom}</div>}
                {feedback.demande_contact.telephone && <div><strong>Téléphone :</strong> <a href={`tel:${feedback.demande_contact.telephone}`} style={{ color: '#C2410C', fontWeight: 700 }}>{feedback.demande_contact.telephone}</a></div>}
                {feedback.demande_contact.email && <div><strong>Email :</strong> {feedback.demande_contact.email}</div>}
              </div>

              {!feedback.demande_contact.traitee && (
                <button
                  onClick={handleTraiterContact}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#C2410C',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <CheckIcon size={15} />
                  <span>Marquer comme recontacté</span>
                </button>
              )}
            </div>
          )}

          {/* 4. Bloc Discordance IA */}
          {feedback.analyse_ia?.discordance_detectee && (
            <div style={{
              background: '#F3E8FF',
              border: '1px solid #E9D5FF',
              borderRadius: '20px',
              padding: '18px 20px',
              marginBottom: '24px',
            }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#7C3AED', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <LightningIcon size={16} color="#7C3AED" />
                <span>Discordance IA Détectée</span>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#5B21B6', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                L'IA a identifié une divergence (ex: Note 5/5 associée à un texte d'insatisfaction cachée).
              </p>

              {discordanceStatus ? (
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: discordanceStatus === 'confirmee' ? '#DC2626' : '#3C7730', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {discordanceStatus === 'confirmee' ? <AlertTriangleIcon size={14} color="#DC2626" /> : <CheckCircleIcon size={14} color="#3C7730" />}
                  <span>Statut discordance : {discordanceStatus === 'confirmee' ? 'Insatisfaction confirmée' : 'Faux positif traité'}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleUpdateDiscordance('confirmee')}
                    disabled={updatingDiscordance}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: '#7C3AED',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                    }}
                  >
                    <LightningIcon size={13} />
                    <span>Confirmer insatisfaction</span>
                  </button>
                  <button
                    onClick={() => handleUpdateDiscordance('traitee_faux_positif')}
                    disabled={updatingDiscordance}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: '#FFFFFF',
                      color: '#7C3AED',
                      border: '1px solid #7C3AED',
                      borderRadius: '12px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                    }}
                  >
                    <CheckIcon size={13} />
                    <span>Faux positif / Traité</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 5. Main Courante / Notes Internes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: 'var(--color-text-muted)', marginBottom: '10px', textTransform: 'uppercase' }}>
              Main Courante (Notes Internes Confidentielles)
            </label>

            <form onSubmit={handleAddNote} style={{ marginBottom: '20px' }}>
              <textarea
                rows={3}
                placeholder="Saisissez une note d'action (ex: Client rappelé à 14h30. Problème d'accueil réglé)..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '14px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-alt)',
                  fontFamily: 'inherit',
                  fontSize: '0.88rem',
                  outline: 'none',
                  resize: 'none',
                  marginBottom: '8px',
                }}
              />
              <button
                type="submit"
                disabled={submittingNote || !noteInput.trim()}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: noteInput.trim() ? '#02302D' : '#94A3B8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '14px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: noteInput.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  transition: 'background 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <PlusIcon size={16} />
                <span>{submittingNote ? 'Enregistrement...' : 'Ajouter la note interne'}</span>
              </button>
            </form>

            {/* Historique Horodaté */}
            {notesInternes.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '16px' }}>
                Aucune note interne enregistrée pour l'instant.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {notesInternes.map((n) => (
                  <div key={n.id} style={{
                    background: '#FFFFFF',
                    borderRadius: '16px',
                    padding: '14px 16px',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#02302D', fontWeight: 700 }}>
                        <UsersIcon size={13} color="#02302D" />
                        <span>{n.auteur}</span>
                      </div>
                      <span style={{ color: 'var(--color-text-muted)' }}>
                        {new Date(n.date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--color-text)', lineHeight: 1.4 }}>
                      {n.texte}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

        </div>
      </div>
    </div>
  );
}

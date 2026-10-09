import React from 'react';
import type { IssueDetail, IssueStatut, CriticiteType } from '../../types';
import Badge from '../ui/Badge';
import SkeletonBlock from '../ui/SkeletonBlock';
import { CheckCircleIcon, ClockIcon } from '../common/Icons';
import { GRAVITE_LABELS, PROBLEME_STATUT_LABELS } from '../../utils/vocabulaire';

const SEVERITE_LABELS: Record<CriticiteType, string> = GRAVITE_LABELS;
const STATUT_LABELS: Record<IssueStatut, string> = PROBLEME_STATUT_LABELS;

const STATUT_BADGE_VARIANT: Record<IssueStatut, 'info' | 'elevee' | 'positif'> = {
  ouverte: 'info',
  action_en_cours: 'elevee',
  resolue: 'positif',
  verifiee: 'positif',
  reouverte: 'elevee',
};

const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

interface IssueDetailModalProps {
  issue: IssueDetail | null;
  loading: boolean;
  onClose: () => void;
  onTerminerAction: (issueId: string, actionId: string) => void | Promise<void>;
  onVerifier: (issueId: string) => void | Promise<void>;
}

/**
 * Détail d'une Issue : tous les champs, feedbacks liés, actions liées avec bouton
 * "Terminer" par action non terminée, et "Marquer vérifiée" uniquement si statut ==
 * 'resolue' (le backend refuse sinon — on évite de proposer un bouton qui échouerait).
 */
export default function IssueDetailModal({ issue, loading, onClose, onTerminerAction, onVerifier }: IssueDetailModalProps) {
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
      <div
        style={{
          width: '720px',
          maxWidth: '100%',
          maxHeight: '92vh',
          background: '#FFFFFF',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="on-dark"
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
          <div style={{ minWidth: 0 }}>
            {issue && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <Badge label={SEVERITE_LABELS[issue.severite]} value={issue.severite} size="md" />
                <Badge label={STATUT_LABELS[issue.statut]} variant={STATUT_BADGE_VARIANT[issue.statut]} size="md" />
              </div>
            )}
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              {issue ? issue.titre : 'Problème à traiter'}
            </h2>
            {issue?.agence_nom && (
              <div style={{ fontSize: '0.8rem', color: '#D6E8D9', marginTop: '4px' }}>{issue.agence_nom}</div>
            )}
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
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Corps ── */}
        <div style={{ padding: '24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {loading || !issue ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <SkeletonBlock height={20} />
              <SkeletonBlock height={80} />
              <SkeletonBlock height={80} />
            </div>
          ) : (
            <>
              {issue.description && (
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>{issue.description}</p>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.8rem', color: '#64748B', fontWeight: 600 }}>
                <span>Enregistré le {formatDate(issue.premiere_detection)}</span>
                {issue.derniere_detection && <span>Dernier avis rattaché le {formatDate(issue.derniere_detection)}</span>}
                {issue.date_resolution && <span>Résolu le {formatDate(issue.date_resolution)}</span>}
                {issue.date_verification && <span>Résolution vérifiée le {formatDate(issue.date_verification)}</span>}
              </div>

              {/* Feedbacks liés */}
              <div>
                <h3 style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#64748B', margin: '0 0 10px' }}>
                  Avis clients liés ({issue.feedbacks.length})
                </h3>
                {issue.feedbacks.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.84rem', color: '#94A3B8' }}>Aucun avis rattaché.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {issue.feedbacks.map((fb) => (
                      <div key={fb.id} style={{ background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '12px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#02302D' }}>Note {fb.note}/5</span>
                          <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>{new Date(fb.date_soumission).toLocaleDateString('fr-FR')}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.84rem', color: '#334155', lineHeight: 1.5 }}>
                          {fb.commentaire || 'Aucun commentaire.'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions correctives liées */}
              <div>
                <h3 style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#64748B', margin: '0 0 10px' }}>
                  Actions à mener ({issue.actions.length})
                </h3>
                {issue.actions.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.84rem', color: '#94A3B8' }}>Aucune action à mener définie.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {issue.actions.map((action) => (
                      <div
                        key={action.id}
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid #E8ECE6',
                          borderRadius: '14px',
                          padding: '14px 16px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '12px',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#02302D' }}>{action.titre}</div>
                          {action.description && (
                            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748B', lineHeight: 1.5 }}>{action.description}</p>
                          )}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px', fontSize: '0.74rem', color: '#94A3B8', fontWeight: 600 }}>
                            {/* responsable_id existe mais aucun champ dénormalisé "responsable_nom" n'est
                                exposé par l'API, et le seul moyen de résoudre un id utilisateur en nom
                                (GET /utilisateurs/) est réservé au CX Manager (403 pour l'Agency Manager,
                                qui a pourtant accès à cette modale) : afficher un nom serait donc
                                incohérent selon le rôle. On affiche juste "Assigné" sans nom plutôt que
                                d'inventer un champ ou risquer un appel en échec. */}
                            {action.responsable_id && <span>Assigné</span>}
                            {action.echeance && <span>Échéance {formatDate(action.echeance)}</span>}
                            {action.date_completion && <span>Terminée le {formatDate(action.date_completion)}</span>}
                          </div>
                        </div>

                        {action.statut !== 'terminee' ? (
                          <button
                            type="button"
                            onClick={() => onTerminerAction(issue.id, action.id)}
                            className="btn-primary"
                            style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: '10px', flexShrink: 0 }}
                          >
                            <CheckCircleIcon size={14} />
                            Terminer
                          </button>
                        ) : (
                          <Badge label="Terminée" variant="positif" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        {!loading && issue && issue.statut === 'resolue' && (
          <div style={{ padding: '16px 28px', borderTop: '1px solid #F1F4EE', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => onVerifier(issue.id)}
              className="btn-primary"
              style={{ padding: '9px 18px', fontSize: '0.84rem', borderRadius: '12px', fontWeight: 800 }}
            >
              <ClockIcon size={15} />
              Confirmer la résolution
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

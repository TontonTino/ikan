import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { lienAvis } from '../../utils/liensAgence';
import type { IssueDetail, IssueStatut } from '../../types';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import SkeletonBlock from '../ui/SkeletonBlock';
import { CheckCircleIcon } from '../common/Icons';
import { fullDate, shortDate } from '../ui/format';
import { GRAVITE_LABELS, PROBLEME_STATUT_LABELS } from '../../utils/vocabulaire';
import { estEnAttente, etatDelai, joursDepuis, libelleJours, prochainGeste } from '../../utils/issueSuivi';
import IssueEscalationSection from './IssueEscalationSection';

const STATUT_BADGE_VARIANT: Record<IssueStatut, 'info' | 'elevee' | 'positif'> = {
  ouverte: 'info',
  action_en_cours: 'elevee',
  resolue: 'positif',
  verifiee: 'positif',
  reouverte: 'elevee',
};

// Position du statut dans le cycle de traitement. Un problème rouvert repart du début.
const ETAPES = ['Enregistré', 'Actions en cours', 'Résolu', 'Résolution vérifiée'];
const ETAPE_ACTUELLE: Record<IssueStatut, number> = { ouverte: 0, reouverte: 0, action_en_cours: 1, resolue: 2, verifiee: 3 };

interface IssueDetailModalProps {
  issue: IssueDetail | null;
  loading: boolean;
  onClose: () => void;
  onTerminerAction: (issueId: string, actionId: string) => void | Promise<void>;
  onVerifier: (issueId: string) => void | Promise<void>;
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h3 style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: 0 }}>
        {titre}
      </h3>
      {children}
    </section>
  );
}

/**
 * Détail d'un problème à traiter, organisé selon le besoin métier : situation, avis liés,
 * suivi (responsable, actions), escalades, résolution. N'affiche que ce que l'API fournit.
 * « Confirmer la résolution » n'est proposé que si le statut est « Résolu » (le backend
 * refuse sinon) ; terminer la dernière action fait passer le problème à « Résolu ».
 */
export default function IssueDetailModal({ issue, loading, onClose, onTerminerAction, onVerifier }: IssueDetailModalProps) {
  const role = useAuthStore((s) => s.user?.role);
  const maintenant = Date.now();
  const delai = issue ? etatDelai(issue, maintenant) : null;
  const actionsRestantes = issue ? issue.actions.filter((a) => a.statut !== 'terminee').length : 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={issue ? issue.titre : 'Problème à traiter'}
      subtitle={issue?.agence_nom}
      footer={
        !loading && issue && issue.statut === 'resolue' ? (
          <>
            <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Confirmez uniquement après avoir constaté que le problème est réellement réglé.
            </span>
            <Button icon={<CheckCircleIcon size={16} />} onClick={() => onVerifier(issue.id)}>Confirmer la résolution</Button>
          </>
        ) : undefined
      }
    >
      {loading || !issue ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} aria-busy="true">
          <SkeletonBlock height={20} />
          <SkeletonBlock height={80} />
          <SkeletonBlock height={80} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* 1. Situation et suivi */}
          <Section titre="Situation">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Badge label={GRAVITE_LABELS[issue.severite]} value={issue.severite} size="md" />
              <Badge label={PROBLEME_STATUT_LABELS[issue.statut]} variant={STATUT_BADGE_VARIANT[issue.statut]} size="md" />
              <strong style={{ fontSize: '0.84rem', color: 'var(--color-text-main)' }}>{prochainGeste(issue.statut)}</strong>
            </div>

            {issue.description ? (
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-body)', lineHeight: 1.6 }}>{issue.description}</p>
            ) : (
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>Aucune description renseignée.</p>
            )}

            <ol aria-label="Étapes du traitement" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {ETAPES.map((etape, i) => {
                const actuelle = i === ETAPE_ACTUELLE[issue.statut];
                const passee = i < ETAPE_ACTUELLE[issue.statut];
                return (
                  <li
                    key={etape}
                    aria-current={actuelle ? 'step' : undefined}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '0.76rem',
                      fontWeight: actuelle ? 800 : 600,
                      border: '1px solid var(--color-border)',
                      background: actuelle ? 'var(--color-primary)' : passee ? 'var(--color-bg-subtle)' : 'transparent',
                      color: actuelle ? '#FFFFFF' : passee ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                    }}
                  >
                    {passee ? '✓ ' : ''}{etape}
                  </li>
                );
              })}
            </ol>
            {issue.statut === 'reouverte' && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                Ce problème a été rouvert après une résolution : il repart du début du cycle.
              </p>
            )}

            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px 20px', fontSize: '0.8rem' }}>
              <div>
                <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Enregistré le</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>
                  {fullDate(issue.premiere_detection)}
                  {estEnAttente(issue.statut) ? ` · il y a ${libelleJours(joursDepuis(issue.premiere_detection, maintenant))}` : ''}
                </dd>
              </div>
              {issue.derniere_detection && (
                <div>
                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Dernier avis rattaché le</dt>
                  <dd style={{ margin: 0, fontWeight: 700 }}>{fullDate(issue.derniere_detection)}</dd>
                </div>
              )}
              {delai && (
                <div>
                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Délai de traitement</dt>
                  <dd style={{ margin: 0, fontWeight: 800, color: delai.etat === 'depasse' ? 'var(--color-critical-text)' : undefined }}>
                    {delai.etat === 'depasse'
                      ? `Dépassé${delai.jours > 0 ? ` depuis ${libelleJours(delai.jours)}` : ' aujourd’hui'} (échéance le ${shortDate(delai.date)})`
                      : `À traiter avant le ${shortDate(delai.date)}`}
                  </dd>
                </div>
              )}
              {issue.date_resolution && (
                <div>
                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Résolu le</dt>
                  <dd style={{ margin: 0, fontWeight: 700 }}>{fullDate(issue.date_resolution)}</dd>
                </div>
              )}
              {issue.date_verification && (
                <div>
                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Résolution vérifiée le</dt>
                  <dd style={{ margin: 0, fontWeight: 700 }}>{fullDate(issue.date_verification)}</dd>
                </div>
              )}
            </dl>
          </Section>

          {/* 2. Avis liés */}
          <Section titre={`Avis clients liés (${issue.feedbacks.length})`}>
            {issue.feedbacks.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>Aucun avis rattaché.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {issue.feedbacks.map((fb) => (
                  <li key={fb.id} style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-main)' }}>Note {fb.note}/5</span>
                      <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>{shortDate(fb.date_soumission)}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-body)', lineHeight: 1.5 }}>
                      {fb.commentaire || 'Aucun commentaire.'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Link to={lienAvis(role, issue.agence_id)} onClick={onClose} className="ui-item__link" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                Retrouver ces avis dans « Avis clients »
              </Link>
            </div>
          </Section>

          {/* 3. Actions et responsable */}
          <Section titre={`Actions à mener (${issue.actions.length})`}>
            {issue.actions.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>Aucune action à mener définie.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {issue.actions.map((action) => {
                  const derniere = action.statut !== 'terminee' && actionsRestantes === 1;
                  return (
                    <li
                      key={action.id}
                      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}
                    >
                      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{action.titre}</div>
                        {action.description && (
                          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{action.description}</p>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px', fontSize: '0.74rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                          {/* responsable_id existe mais l'API n'expose aucun nom : seul le CX Manager peut
                              résoudre un id en nom (GET /utilisateurs/), alors que l'Agency Manager a aussi
                              accès à cette fenêtre. On indique « Assigné » sans nom plutôt que d'inventer. */}
                          {action.responsable_id ? <span>Assigné</span> : <span>Responsable non renseigné</span>}
                          {action.echeance && <span>Échéance {shortDate(action.echeance)}</span>}
                          {action.date_completion && <span>Terminée le {shortDate(action.date_completion)}</span>}
                        </div>
                        {derniere && (
                          <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                            Terminer cette dernière action fera passer le problème à « Résolu ».
                          </p>
                        )}
                      </div>

                      {action.statut !== 'terminee' ? (
                        <Button size="sm" icon={<CheckCircleIcon size={14} />} onClick={() => onTerminerAction(issue.id, action.id)}>
                          Terminer
                        </Button>
                      ) : (
                        <Badge label="Terminée" variant="positif" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* 4. Escalades */}
          <Section titre="Escalades">
            <IssueEscalationSection issueId={issue.id} statut={issue.statut} />
          </Section>
        </div>
      )}
    </Modal>
  );
}

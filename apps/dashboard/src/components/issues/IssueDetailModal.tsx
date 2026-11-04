import React, { useEffect, useState } from 'react';
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
import { peutVerifierResolution, personnesAssignables } from '../../utils/actionsProbleme';
import type { ActionCorrective } from '../../types';
import ActionsDuProbleme from './ActionsDuProbleme';
import DefinirActionDialog from './DefinirActionDialog';
import IssueEscalationSection from './IssueEscalationSection';
import Section from './SectionDetail';
import TerminerActionDialog from './TerminerActionDialog';
import { useResponsables } from './useResponsables';

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
  /** Une action vient d'être créée ou terminée (ou n'existe plus) : annonce le résultat, rafraîchit la liste et le détail. */
  onActionsChange: (issueId: string, message: string) => void | Promise<void>;
  onVerifier: (issueId: string) => void | Promise<void>;
}

/**
 * Détail d'un problème à traiter, organisé selon le besoin métier : situation, avis liés,
 * suivi (responsable, actions), escalades, résolution. N'affiche que ce que l'API fournit.
 * « Confirmer la résolution » n'est proposé que si le statut est « Résolu » (le backend
 * refuse sinon) ; terminer la dernière action fait passer le problème à « Résolu ».
 */
export default function IssueDetailModal({ issue, loading, onClose, onActionsChange, onVerifier }: IssueDetailModalProps) {
  const moi = useAuthStore((s) => s.user);
  const role = moi?.role;
  const [definirOuvert, setDefinirOuvert] = useState(false);
  const [actionATerminer, setActionATerminer] = useState<ActionCorrective | null>(null);
  const [nouvelleActionId, setNouvelleActionId] = useState<string | null>(null);
  // La liste des personnes n'est lisible que par le CX Manager (l'API la refuse à l'Agency Manager : aucun appel pour lui).
  const { etat: responsables, recharger: rechargerResponsables } = useResponsables(role === 'cx_manager' && !!issue);
  const utilisateurs = responsables.statut === 'ok' ? responsables.utilisateurs : [];
  const personnes = issue && moi ? personnesAssignables(utilisateurs, issue.agence_id, moi) : [];

  // Après une création : la nouvelle action reçoit le focus (lecteurs d'écran) et un repère visuel discret, retiré au bout de quelques secondes.
  useEffect(() => {
    if (!nouvelleActionId || !issue?.actions.some((a) => a.id === nouvelleActionId)) return undefined;
    const el = document.getElementById(`action-${nouvelleActionId}`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'nearest' });
    const t = window.setTimeout(() => setNouvelleActionId(null), 4000);
    return () => window.clearTimeout(t);
  }, [nouvelleActionId, issue?.actions]);
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
          peutVerifierResolution(role) ? (
            <>
              <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                Confirmez uniquement après avoir constaté que le problème est réellement réglé.
              </span>
              <Button icon={<CheckCircleIcon size={16} />} onClick={() => onVerifier(issue.id)}>Confirmer la résolution</Button>
            </>
          ) : (
            <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Toutes les actions sont terminées. Le CX Manager confirmera que le problème est réellement réglé.
            </span>
          )
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
          <ActionsDuProbleme
            issue={issue}
            role={role}
            utilisateurs={utilisateurs}
            moiId={moi?.id}
            nouvelleActionId={nouvelleActionId}
            onDefinir={() => setDefinirOuvert(true)}
            onTerminer={setActionATerminer}
          />

          {/* 4. Escalades */}
          <Section titre="Escalades">
            <IssueEscalationSection issueId={issue.id} statut={issue.statut} />
          </Section>
        </div>
      )}
      {issue && (
        <>
          <DefinirActionDialog
            issue={definirOuvert ? issue : null}
            personnes={personnes}
            responsables={responsables}
            onRechargerResponsables={rechargerResponsables}
            onFermer={() => setDefinirOuvert(false)}
            onCree={(action) => {
              setDefinirOuvert(false);
              setNouvelleActionId(action.id);
              void onActionsChange(issue.id, `Action définie : ${action.titre}`);
            }}
            onDisparu={(message) => { setDefinirOuvert(false); void onActionsChange(issue.id, message); }}
          />
          <TerminerActionDialog
            action={actionATerminer}
            issueId={issue.id}
            derniere={!!actionATerminer && actionsRestantes === 1}
            onFermer={() => setActionATerminer(null)}
            onTerminee={() => { setActionATerminer(null); void onActionsChange(issue.id, 'Action marquée comme terminée'); }}
            onDisparue={(message) => { setActionATerminer(null); void onActionsChange(issue.id, message); }}
          />
        </>
      )}
    </Modal>
  );
}

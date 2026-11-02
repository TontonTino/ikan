import React, { Dispatch, SetStateAction, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import YamEtatVide from '../../components/agent/YamEtatVide';
import { YAM_PRESENCE } from '../../config';
import { lienAvis } from '../../utils/liensAgence';
import type { Agence, Feedback } from '../../types';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { StatsErrorState } from '../../components/stats/StatsStates';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import ProblemesAvecActionsNote from '../../components/issues/ProblemesAvecActionsNote';
import { CheckCircleIcon, UsersIcon } from '../../components/common/Icons';
import { shortDate } from '../../components/ui/format';
import { joursDepuis, libelleJours } from '../../utils/issueSuivi';
import { extraitCommentaire } from './pilotageFormatters';

type Props = {
  isAgencyManager: boolean; agencesList: Agence[]; actionsToggle: 'en_cours' | 'terminees'; setActionsToggle: Dispatch<SetStateAction<'en_cours' | 'terminees'>>;
  actionsEnCours: Feedback[]; actionsTerminees: Feedback[]; actionsEnCoursTotal: number; actionsTermineesTotal: number;
  actionsLoading: boolean; actionsError: boolean; refetchActions: () => void; actionsFirstLoadDone: boolean; actionsLoadingMore: boolean; loadMoreActions: () => void;
  actionsAgenceId: string | null; setActionsAgenceId: Dispatch<SetStateAction<string | null>>; marquerActionRealisee: (id: string) => Promise<void>;
};

/**
 * Actions décidées sur un AVIS client (champ « action à prendre » d'un avis). Elles n'ont ni
 * échéance, ni statut « à faire » : seulement « en cours » ou « terminée ». Les actions d'un
 * PROBLÈME se gèrent dans « Problèmes à traiter » (voir la note en haut de la page).
 */
export default function PilotageActionsCorrectivesTab({ isAgencyManager, agencesList, actionsToggle, setActionsToggle, actionsEnCours, actionsTerminees, actionsEnCoursTotal, actionsTermineesTotal, actionsLoading, actionsError, refetchActions, actionsFirstLoadDone, actionsLoadingMore, loadMoreActions, actionsAgenceId, setActionsAgenceId, marquerActionRealisee }: Props) {
  const enCours = actionsToggle === 'en_cours';
  const actionsAffichees = enCours ? actionsEnCours : actionsTerminees;
  const total = enCours ? actionsEnCoursTotal : actionsTermineesTotal;
  const navigate = useNavigate();
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<string | null>(null);
  const maintenant = Date.now();

  const confirmer = async (id: string) => {
    setEnregistrement(id);
    try {
      await marquerActionRealisee(id);
    } finally {
      setEnregistrement(null);
      setAConfirmer(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Alert tone="info" title="Deux sortes d’actions">
        <p style={{ margin: 0 }}>
          Cette page liste les actions décidées pour répondre à un <strong>avis client</strong>. Les actions d’un <strong>problème à traiter</strong>{' '}
          se consultent et se terminent dans le détail du problème.
        </p>
        <ProblemesAvecActionsNote />
      </Alert>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div className="ui-segmented" role="group" aria-label="État des actions">
          <button type="button" className="ui-segmented__item" aria-pressed={enCours} onClick={() => setActionsToggle('en_cours')} style={{ minHeight: 44 }}>
            En cours {actionsFirstLoadDone && !actionsError ? `(${actionsEnCoursTotal})` : ''}
          </button>
          <button type="button" className="ui-segmented__item" aria-pressed={!enCours} onClick={() => setActionsToggle('terminees')} style={{ minHeight: 44 }}>
            Terminées {actionsFirstLoadDone && !actionsError ? `(${actionsTermineesTotal})` : ''}
          </button>
        </div>
        {!isAgencyManager && (
          <AgenceFilterSelect agences={agencesList} selectedId={actionsAgenceId} onChange={setActionsAgenceId} />
        )}
      </div>

      {!enCours && !actionsError && (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Une action terminée indique qu’elle a été faite, pas que le client est satisfait : vérifiez-le dans les nouveaux avis de l’agence.
        </p>
      )}

      {actionsError ? (
        <StatsErrorState message="Impossible de charger les actions. Cela ne signifie pas qu’il n’y en a pas." onRetry={refetchActions} />
      ) : actionsLoading ? (
        <div aria-busy="true" aria-label="Chargement des actions à mener" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} height={120} radius="var(--radius-xl)" />
          ))}
        </div>
      ) : actionsAffichees.length === 0 && YAM_PRESENCE && enCours && !actionsAgenceId ? (
        <Card tone="success" padding="none">
          <YamEtatVide
            titre="Aucune action en cours."
            texte="Quand un problème revient dans une agence, vous pourrez le regrouper ici et lancer une action. Commencez par consulter vos alertes."
            action={{ label: 'Voir les alertes', onClick: () => navigate('/alertes') }}
          />
        </Card>
      ) : actionsAffichees.length === 0 ? (
        <Card tone="success" padding="none">
          <EmptyState
            illustration="no-alert"
            title={
              actionsAgenceId
                ? 'Aucune action pour cette agence'
                : enCours ? 'Aucune action en cours' : 'Aucune action terminée pour l’instant'
            }
            message={
              actionsAgenceId
                ? 'Aucune action de ce type n’existe pour l’agence sélectionnée.'
                : enCours
                  ? 'Aucune action n’est en attente de réalisation sur des avis clients.'
                  : 'Les actions confirmées comme réalisées apparaîtront ici.'
            }
            action={actionsAgenceId ? { label: 'Voir toutes les agences', onClick: () => setActionsAgenceId(null) } : undefined}
          />
        </Card>
      ) : (
        <>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none' }}>
            {actionsAffichees.map((f) => {
              const confirmation = aConfirmer === f.id;
              const occupe = enregistrement === f.id;
              return (
                <Card as="li" key={f.id} padding="sm" className={`ui-item${enCours ? '' : ' ui-action-card--done'}`}>
                  <div className="ui-item__head">
                    <Badge variant={enCours ? 'warning' : 'success'} label={enCours ? 'En cours' : 'Terminée'} />
                    <Badge variant="outline" label="Liée à un avis" />
                    {f.issue_id && <Badge variant="info" label="L’avis est rattaché à un problème" />}
                  </div>

                  <h3 className="ui-item__title">{f.action_a_prendre || 'Action non détaillée'}</h3>

                  <blockquote style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--color-border-strong)', background: 'var(--color-bg-subtle)', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
                      Pourquoi : avis du {shortDate(f.date_soumission)} · note {f.note}/5
                    </div>
                    <p className="ui-item__text" style={{ margin: '4px 0 0' }}>
                      {f.commentaire ? `« ${extraitCommentaire(f.commentaire, 220)} »` : 'Aucun commentaire laissé par le client.'}
                    </p>
                  </blockquote>

                  <div className="ui-item__meta">
                    {!isAgencyManager && f.agence_nom && (
                      <>
                        <span>{f.agence_nom}</span>
                        <span className="ui-item__meta-sep" aria-hidden="true" />
                      </>
                    )}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                      <UsersIcon size={14} aria-hidden="true" />
                      {f.assigne_a_nom ? `Assignée à ${f.assigne_a_nom}` : 'Non assignée'}
                    </span>
                    {enCours && f.date_assignation && (
                      <>
                        <span className="ui-item__meta-sep" aria-hidden="true" />
                        <span>En cours depuis {libelleJours(joursDepuis(f.date_assignation, maintenant))}</span>
                      </>
                    )}
                    {!enCours && f.date_resolution && (
                      <>
                        <span className="ui-item__meta-sep" aria-hidden="true" />
                        <span>Réalisée le {shortDate(f.date_resolution)}</span>
                      </>
                    )}
                  </div>

                  <div className="ui-item__foot">
                    <Link to={lienAvis(isAgencyManager ? 'agency_manager' : 'cx_manager', f.agence_id, undefined, { avisId: f.id })} className="ui-item__link" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                      Retrouver l’avis dans « Avis clients »
                    </Link>
                    {f.issue_id && (
                      <Link to="/issues" className="ui-item__link" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                        Voir les problèmes à traiter
                      </Link>
                    )}
                    <span className="ui-item__spacer" />
                    {enCours && !confirmation && (
                      <Button variant="secondary" icon={<CheckCircleIcon size={15} />} onClick={() => setAConfirmer(f.id)}>
                        Marquer comme réalisée
                      </Button>
                    )}
                  </div>

                  {enCours && confirmation && (
                    <div role="group" aria-label="Confirmer que l’action est réalisée" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-bg, var(--color-bg-subtle))', border: '1px solid var(--color-warning-border)' }}>
                      <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-main)', lineHeight: 1.5 }}>
                        En confirmant, l’avis passera à « Résolu » et sortira des alertes. Cela n’indique pas que le client est satisfait.
                      </p>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <Button onClick={() => confirmer(f.id)} loading={occupe}>Confirmer : l’action est réalisée</Button>
                        <Button variant="ghost" onClick={() => setAConfirmer(null)} disabled={occupe}>Annuler</Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </ul>
          {actionsAffichees.length < total && (
            <Button variant="secondary" onClick={loadMoreActions} loading={actionsLoadingMore} style={{ alignSelf: 'center' }}>
              {actionsLoadingMore ? 'Chargement…' : `Charger plus (${actionsAffichees.length}/${total})`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

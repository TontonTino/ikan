import React from 'react';
import type { ActionCorrective, IssueDetail, UserRole } from '../../types';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { CheckCircleIcon, PlusIcon } from '../common/Icons';
import { fullDate, shortDate } from '../ui/format';
import { libelleEtatAction, libelleResponsable, peutDefinirAction, peutTerminerAction, type UtilisateurListe } from '../../utils/actionsProbleme';
import SectionDetail from './SectionDetail';

interface Props {
  issue: IssueDetail;
  role: UserRole | undefined;
  /** Personnes connues (CX Manager seulement) pour afficher un nom ; vide sinon. */
  utilisateurs: readonly UtilisateurListe[];
  moiId: string | undefined;
  /** Action qui vient d'être créée : repère visuel discret. */
  nouvelleActionId: string | null;
  onDefinir: () => void;
  onTerminer: (action: ActionCorrective) => void;
}

/**
 * « Actions à mener » d'un problème : état, responsable, échéance de chaque action, « Définir une action » (CX Manager, problème encore à traiter) et
 * « Terminer » (CX Manager ou Agency Manager). Un rôle sans droit ne voit aucun bouton : un texte dit qui décide, rien n'est grisé sans explication.
 */
export default function ActionsDuProbleme({ issue, role, utilisateurs, moiId, nouvelleActionId, onDefinir, onTerminer }: Props) {
  const peutDefinir = peutDefinirAction(role, issue.statut);
  const sansAction = issue.actions.length === 0;

  return (
    <SectionDetail
      titre={`Actions à mener (${issue.actions.length})`}
      action={peutDefinir ? (
        <Button size="sm" variant={sansAction ? 'primary' : 'secondary'} icon={<PlusIcon size={14} />} onClick={onDefinir}>
          Définir une action
        </Button>
      ) : undefined}
    >
      <span className="ui-sr-only" role="status">{nouvelleActionId ? 'Action ajoutée.' : ''}</span>
      {sansAction ? (
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>
          {peutDefinir
            ? 'Aucune action définie. Décidez de la première action à mener pour régler ce problème.'
            : issue.statut === 'resolue' || issue.statut === 'verifiee'
              ? 'Aucune action n’a été définie pour ce problème.'
              : 'Aucune action définie pour le moment. Le CX Manager décide de l’action à mener.'}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {issue.actions.map((action) => (
            <li
              key={action.id}
              id={`action-${action.id}`}
              tabIndex={-1}
              className={nouvelleActionId === action.id ? 'action-probleme is-nouvelle' : undefined}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-trait)', borderRadius: 'var(--radius-md)', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}
            >
              <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{action.titre}</span>
                  <Badge label={libelleEtatAction(action.statut)} variant={action.statut === 'terminee' ? 'positif' : 'neutral'} />
                </div>
                {action.description && (
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{action.description}</p>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px', fontSize: '0.74rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {/* responsable_id existe mais l'API n'expose aucun nom : seul le CX Manager peut résoudre un id en nom (GET /utilisateurs/,
                      Agency Managers). Sinon « Vous » ou « Assigné » : jamais un nom inventé. */}
                  <span>Responsable : {libelleResponsable(action.responsable_id, utilisateurs, moiId, action.responsable_nom)}</span>
                  {action.echeance
                    ? <span>Échéance <time dateTime={action.echeance} title={fullDate(action.echeance)}>{shortDate(action.echeance)}</time></span>
                    : <span>Sans échéance</span>}
                  {action.date_completion && (
                    <span>Terminée le <time dateTime={action.date_completion} title={fullDate(action.date_completion)}>{shortDate(action.date_completion)}</time></span>
                  )}
                </div>
              </div>
              {action.statut !== 'terminee' && peutTerminerAction(role, action.responsable_id, moiId) && (
                <Button size="sm" icon={<CheckCircleIcon size={14} />} onClick={() => onTerminer(action)}>
                  Terminer
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionDetail>
  );
}

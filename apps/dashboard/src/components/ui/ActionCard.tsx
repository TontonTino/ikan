import React from 'react';
import type { Feedback } from '../../types';
import Badge from './Badge';
import Button from './Button';
import Card from './Card';
import { CalendarIcon, CheckIcon, ClockIcon, UsersIcon } from '../common/Icons';
import { fullDate, relativeTime, shortDate } from './format';

export type ActionStatus = 'a_faire' | 'en_cours' | 'terminee';

export interface ActionCardData {
  id: string;
  title: string;
  description?: string;
  status: ActionStatus;
  /** Responsable (nom affiché). */
  owner?: string;
  /** Date d'assignation / création (ISO). */
  createdAt?: string;
  /**
   * Échéance (ISO). ⚠ Non fournie par l'API à ce jour : le champ n'est
   * affiché que s'il est présent, jamais estimé.
   */
  dueDate?: string;
  agencyName?: string;
  /** Contexte d'origine (thème, feedback, alerte) — chemin problème → action. */
  source?: string;
  /**
   * Impact mesuré. ⚠ Non calculé par l'API à ce jour : affiché seulement si fourni.
   */
  impact?: { label: string; isPositive: boolean };
}

const STATUS_LABEL: Record<ActionStatus, string> = { a_faire: 'À faire', en_cours: 'En cours', terminee: 'Terminée' };
const STATUS_TONE: Record<ActionStatus, 'neutral' | 'warning' | 'success'> = { a_faire: 'neutral', en_cours: 'warning', terminee: 'success' };

/**
 * Adaptateur : dans l'API actuelle, une action corrective est portée par un
 * Feedback (action_a_prendre, action_realisee, assigne_a_nom, date_assignation).
 */
export function actionFromFeedback(f: Feedback): ActionCardData {
  return {
    id: f.id,
    title: f.action_a_prendre || 'Action à mener',
    description: f.commentaire,
    status: f.action_realisee ? 'terminee' : f.action_a_prendre ? 'en_cours' : 'a_faire',
    owner: f.assigne_a_nom,
    createdAt: f.date_assignation,
    agencyName: f.agence_nom,
    source: f.analyse_ia?.theme_principal,
  };
}

export interface ActionCardProps {
  action: ActionCardData;
  showAgency?: boolean;
  onOpen?: (action: ActionCardData) => void;
  /** Marque l'action comme réalisée (bouton affiché si l'action n'est pas terminée). */
  onComplete?: (action: ActionCardData) => void | Promise<void>;
  completing?: boolean;
  headingLevel?: 2 | 3 | 4;
}

export default function ActionCard({ action, showAgency = false, onOpen, onComplete, completing = false, headingLevel = 3 }: ActionCardProps) {
  const Heading = `h${headingLevel}` as React.ElementType;
  const done = action.status === 'terminee';
  const overdue = !done && action.dueDate ? new Date(action.dueDate).getTime() < Date.now() : false;

  return (
    <Card as="article" padding="sm" tone={overdue ? 'critical' : 'default'} className={`ui-item${done ? ' ui-action-card--done' : ''}`}>
      <div className="ui-item__head">
        <Badge variant={STATUS_TONE[action.status]} label={STATUS_LABEL[action.status]} icon={done ? <CheckIcon size={12} /> : undefined} />
        {overdue && <Badge variant="critical" label="En retard" icon={<ClockIcon size={12} />} />}
        {action.impact && (
          <Badge variant={action.impact.isPositive ? 'success' : 'critical'} label={`Impact : ${action.impact.label}`} />
        )}
      </div>

      <Heading className="ui-item__title">
        {onOpen ? (
          <button type="button" className="ui-item__link" onClick={() => onOpen(action)}>
            {action.title}
          </button>
        ) : (
          action.title
        )}
      </Heading>
      {action.description && <p className="ui-item__text">{action.description}</p>}

      <div className="ui-item__meta">
        {showAgency && action.agencyName && (
          <>
            <span>{action.agencyName}</span>
            <span className="ui-item__meta-sep" aria-hidden="true" />
          </>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <UsersIcon size={14} aria-hidden="true" />
          {action.owner ? action.owner : 'Non assignée'}
        </span>
        {action.dueDate && (
          <>
            <span className="ui-item__meta-sep" aria-hidden="true" />
            <span className={overdue ? 'ui-action-card__overdue' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <CalendarIcon size={14} aria-hidden="true" />
              Échéance <time dateTime={action.dueDate}>{shortDate(action.dueDate)}</time>
            </span>
          </>
        )}
        {!action.dueDate && action.createdAt && (
          <>
            <span className="ui-item__meta-sep" aria-hidden="true" />
            <time dateTime={action.createdAt} title={fullDate(action.createdAt)}>Assignée {relativeTime(action.createdAt)}</time>
          </>
        )}
      </div>

      {onComplete && !done && (
        <div className="ui-item__foot">
          <Button size="sm" variant="secondary" icon={<CheckIcon size={14} />} loading={completing} onClick={() => onComplete(action)}>
            Marquer comme réalisée
          </Button>
        </div>
      )}
    </Card>
  );
}

import React from 'react';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XCloseIcon } from '../common/Icons';
import IconButton from './IconButton';

export type AlertTone = 'success' | 'warning' | 'critical' | 'info';

export interface AlertProps {
  tone?: AlertTone;
  title: React.ReactNode;
  children?: React.ReactNode;
  /** Action directe (ex. <Button size="sm">Voir les feedbacks</Button>) : chemin court problème → action. */
  action?: React.ReactNode;
  onDismiss?: () => void;
  /** Remplace l'icône par défaut du ton. */
  icon?: React.ReactNode;
}

const ICONS: Record<AlertTone, React.ReactNode> = {
  success: <CheckCircleIcon size={20} />,
  warning: <AlertTriangleIcon size={20} />,
  critical: <AlertTriangleIcon size={20} />,
  info: <InfoIcon size={20} />,
};

/** Préfixe lu par les lecteurs d'écran : le ton n'est jamais porté par la seule couleur. */
const SR_PREFIX: Record<AlertTone, string> = {
  success: 'Succès : ',
  warning: 'Attention : ',
  critical: 'Critique : ',
  info: 'Information : ',
};

/**
 * Message contextuel inline (dans une page ou une carte).
 * Pour un événement éphémère, utiliser useToast() ; pour une alerte métier
 * détaillée, la page Alertes.
 */
export default function Alert({ tone = 'info', title, children, action, onDismiss, icon }: AlertProps) {
  return (
    <div className={`ui-alert ui-alert--${tone}`} role={tone === 'critical' ? 'alert' : 'status'}>
      <span className="ui-alert__icon" aria-hidden="true">{icon ?? ICONS[tone]}</span>
      <div className="ui-alert__content">
        <p className="ui-alert__title">
          <span className="ui-sr-only">{SR_PREFIX[tone]}</span>
          {title}
        </p>
        {children && <div className="ui-alert__body">{children}</div>}
        {action && <div className="ui-alert__action">{action}</div>}
      </div>
      {onDismiss && <IconButton label="Masquer ce message" icon={<XCloseIcon size={16} />} size="sm" variant="ghost" onClick={onDismiss} />}
    </div>
  );
}

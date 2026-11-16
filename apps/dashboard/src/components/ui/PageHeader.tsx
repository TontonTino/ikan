import React from 'react';
import PageTitle from './PageTitle';
import Button from './Button';
import { RefreshIcon, DownloadIcon } from '../common/Icons';

export interface PageHeaderProps {
  title?: string;
  greetingUser?: string;
  subtitle: string;
  /** Conservé pour compatibilité : la date du jour n'est plus affichée (elle n'aide à aucune décision). */
  dateText?: string;
  onRefresh?: () => void;
  onExport?: () => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  /** Conservé pour compatibilité, sans effet. */
  showDateBesideActions?: boolean;
  children?: React.ReactNode;
}

/**
 * En-tête de page historique (administration, paramètres, statistiques agence), désormais rendu comme toutes les autres pages :
 * le même PageTitle léger (titre, une phrase, actions à droite), sans carte autour ni date en surtitre.
 * Une seule action principale (corail) ; Actualiser et Exporter restent secondaires.
 */
export default function PageHeader({ title, greetingUser, subtitle, onRefresh, onExport, primaryAction, children }: PageHeaderProps) {
  const actions = (onRefresh || onExport || primaryAction || children) ? (
    <>
      {children}
      {onRefresh && (
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={15} />} onClick={onRefresh} aria-label="Actualiser les données">
          Actualiser
        </Button>
      )}
      {onExport && (
        <Button variant="secondary" size="sm" icon={<DownloadIcon size={15} />} onClick={onExport}>
          Exporter
        </Button>
      )}
      {primaryAction && (
        <Button icon={primaryAction.icon} onClick={primaryAction.onClick}>
          {primaryAction.label}
        </Button>
      )}
    </>
  ) : undefined;

  return <PageTitle title={greetingUser ? `Bonjour, ${greetingUser}` : title ?? ''} description={subtitle} actions={actions} />;
}

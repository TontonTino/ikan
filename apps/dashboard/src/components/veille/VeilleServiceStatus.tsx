import React from 'react';
import { WifiHighIcon, WifiSlashIcon, CheckCircleIcon, AlertTriangleIcon } from '../common/Icons';
import type { VeilleFacebookPage, VeilleFacebookStatus } from '../../types';

interface VeilleServiceStatusProps {
  status: VeilleFacebookStatus | null;
}

function formatExpiration(page: VeilleFacebookPage): string | undefined {
  const ts = page.expires_at && page.expires_at > 0 ? page.expires_at : null;
  if (!ts) return undefined;
  return `Accès valable jusqu'au ${new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`;
}

/** Indicateurs d'état (service + Page Facebook) : icône + texte, jamais la couleur seule. */
export default function VeilleServiceStatus({ status }: VeilleServiceStatusProps) {
  const online = status?.service === 'online';
  // État des Pages inconnu si le service est hors ligne ou si la liste n'a pas pu être lue :
  // on n'affiche alors aucun badge de Page plutôt qu'un « Aucune page connectée » non vérifié.
  const pagesConnues = online && status?.pages_disponibles === true;
  const pages = status?.pages ?? [];
  const pagesSaines = pages.filter((p) => p.status === 'active' && !p.needs_attention);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '6px' }}>
      <span className={`badge ${online ? 'badge-success' : 'badge-error'}`}>
        {online ? <WifiHighIcon size={14} /> : <WifiSlashIcon size={14} />}
        {online ? 'Service en ligne' : 'Service hors ligne'}
      </span>
      {pagesConnues &&
        (pagesSaines.length > 0 ? (
          <span className="badge badge-success" title={formatExpiration(pagesSaines[0])}>
            <CheckCircleIcon size={14} />
            Page connectée : {pagesSaines.map((p) => p.page_name).join(', ')}
          </span>
        ) : pages.length > 0 ? (
          <span className="badge badge-warning">
            <AlertTriangleIcon size={14} />
            Session Facebook à renouveler
          </span>
        ) : (
          <span className="badge badge-warning">
            <AlertTriangleIcon size={14} />
            Aucune page connectée
          </span>
        ))}
    </div>
  );
}

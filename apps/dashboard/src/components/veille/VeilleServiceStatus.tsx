import React from 'react';
import { WifiHighIcon, WifiSlashIcon, CheckCircleIcon, AlertTriangleIcon } from '../common/Icons';
import type { VeilleStatusResponse } from '../../types';

interface VeilleServiceStatusProps {
  status: VeilleStatusResponse | null;
}

/** Indicateur d'état du microservice de veille : icône + texte, jamais la couleur seule. */
export default function VeilleServiceStatus({ status }: VeilleServiceStatusProps) {
  const online = status?.service.status === 'online';
  const sessionValid = status?.facebook_session?.valid === true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
      <span className={`badge ${online ? 'badge-success' : 'badge-error'}`}>
        {online ? <WifiHighIcon size={14} /> : <WifiSlashIcon size={14} />}
        {online ? 'Service en ligne' : 'Service hors ligne'}
      </span>
      <span className={`badge ${sessionValid ? 'badge-success' : 'badge-warning'}`}>
        {sessionValid ? <CheckCircleIcon size={14} /> : <AlertTriangleIcon size={14} />}
        {sessionValid ? 'Session Facebook valide' : 'Session Facebook à renouveler'}
      </span>
    </div>
  );
}

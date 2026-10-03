import React from 'react';

export default function RouteLoadingFallback() {
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="route-loading__spinner" aria-hidden="true" />
      <span>Chargement de la page…</span>
    </div>
  );
}

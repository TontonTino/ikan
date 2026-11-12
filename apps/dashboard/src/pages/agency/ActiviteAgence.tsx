import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { agencesApi } from '../../services/api';
import type { ActiviteAgenceItem } from '../../types';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import { StatsErrorState } from '../../components/stats/StatsStates';
import { libelleEvenementAgence } from '../../utils/vocabulaire';
import { ACTIVITE_INITIALE, activiteReducer, type ActiviteState } from './activiteState';

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: '20px',
  border: '1px solid var(--color-trait)',
  padding: '22px',
};

/** Présentation du fil d'activité : un état à la fois, sans jamais présenter une erreur comme « aucun événement ». */
export function ActiviteListe({ etat, onRetry }: { etat: ActiviteState; onRetry: () => void }) {
  const { statut, evenements } = etat;
  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 14px', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>Fil d'activité</h3>
      {statut === 'chargement' && evenements.length === 0 ? (
        <div role="status" aria-busy="true" aria-label="Chargement de l'activité" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} height={58} radius="var(--radius-md)" />)}
        </div>
      ) : statut === 'erreur' && evenements.length === 0 ? (
        <StatsErrorState message="Impossible de charger l’activité de l’agence." onRetry={onRetry} />
      ) : evenements.length === 0 ? (
        <div className="t-2 t-sm t-semi">Aucun événement récent.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {statut === 'erreur' && (
            <StatsErrorState message="L’activité n’a pas pu être actualisée. La liste affichée peut être incomplète." onRetry={onRetry} />
          )}
          {evenements.map((ev: ActiviteAgenceItem) => (
            <div key={ev.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 14px', background: 'var(--color-bg)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <span className="t-sm t-semi t-encre">{ev.auteur_nom}</span>
                <span className="t-xs t-2">{new Date(ev.date).toLocaleString('fr-FR')}</span>
              </div>
              <span className="t-xs t-bon t-semi">{libelleEvenementAgence(ev.type_evenement)}</span>
              {ev.details && <p style={{ margin: '2px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-2)' }}>{ev.details}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Onglet « Activité » de l'aperçu d'agence (CX Manager). Le serveur décide de ce qui est lisible
 * (GET /agences/{id}/activite) ; à monter avec `key={agenceId}` pour repartir d'un état neuf.
 */
export default function ActiviteAgence({ agenceId }: { agenceId: string }) {
  const [etat, dispatch] = useReducer(activiteReducer, ACTIVITE_INITIALE);
  const requete = useRef(0);

  const charger = useCallback(async () => {
    const id = ++requete.current;
    dispatch({ type: 'debut' });
    try {
      const res = await agencesApi.activite(agenceId);
      if (id === requete.current) dispatch({ type: 'succes', evenements: Array.isArray(res.data) ? res.data : [] });
    } catch {
      if (id === requete.current) dispatch({ type: 'echec' });
    }
  }, [agenceId]);

  useEffect(() => {
    charger();
    return () => { requete.current += 1; };
  }, [charger]);

  return <ActiviteListe etat={etat} onRetry={charger} />;
}

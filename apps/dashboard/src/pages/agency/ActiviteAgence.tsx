import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { agencesApi } from '../../services/api';
import type { ActiviteAgenceItem } from '../../types';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import { StatsErrorState } from '../../components/stats/StatsStates';
import { libelleEvenementAgence } from '../../utils/vocabulaire';
import { ACTIVITE_INITIALE, activiteReducer, type ActiviteState } from './activiteState';

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '20px',
  border: '1px solid #E8ECE6',
  padding: '22px',
  boxShadow: '0 2px 12px rgba(20, 60, 40, 0.03)',
};

/** Présentation du fil d'activité : un état à la fois, sans jamais présenter une erreur comme « aucun événement ». */
export function ActiviteListe({ etat, onRetry }: { etat: ActiviteState; onRetry: () => void }) {
  const { statut, evenements } = etat;
  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 14px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>Fil d'activité</h3>
      {statut === 'chargement' && evenements.length === 0 ? (
        <div role="status" aria-busy="true" aria-label="Chargement de l'activité" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} height={58} radius="var(--radius-md)" />)}
        </div>
      ) : statut === 'erreur' && evenements.length === 0 ? (
        <StatsErrorState message="Impossible de charger l’activité de l’agence." onRetry={onRetry} />
      ) : evenements.length === 0 ? (
        <div style={{ color: '#64748B', fontSize: '0.86rem', fontWeight: 600 }}>Aucun événement récent.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {statut === 'erreur' && (
            <StatsErrorState message="L’activité n’a pas pu être actualisée. La liste affichée peut être incomplète." onRetry={onRetry} />
          )}
          {evenements.map((ev: ActiviteAgenceItem) => (
            <div key={ev.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>{ev.auteur_nom}</span>
                <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{new Date(ev.date).toLocaleString('fr-FR')}</span>
              </div>
              <span style={{ fontSize: '0.78rem', color: '#3C7730', fontWeight: 700 }}>{libelleEvenementAgence(ev.type_evenement)}</span>
              {ev.details && <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#64748B' }}>{ev.details}</p>}
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

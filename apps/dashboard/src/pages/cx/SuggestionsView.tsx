import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { suggestionsApi } from '../../services/api';
import type { IdeaStatus } from '../../types';
import { useToast } from '../../components/ui/Toast';
import PilotageIdeasTab from './PilotageIdeasTab';
import { STATUS_LABELS } from './pilotageConstants';
import { SUGGESTIONS_INITIAL, parametresSuggestions, suggestionsReducer, totalAnnonce } from './suggestionsState';



/**
 * Suggestions clients : chargement, erreur avec réessai, liste vide et liste remplie sont des états distincts.
 * `agenceId` (aperçu d'une agence du CX Manager) est transmis au serveur, qui l'ajoute à son propre périmètre :
 * le filtre n'est jamais fait côté navigateur et ne constitue pas une autorisation.
 * À monter avec `key={agenceId}` pour repartir d'un état neuf quand l'agence change.
 */
export default function SuggestionsView({ agenceId }: { agenceId?: string }) {
  const toast = useToast();
  const [etat, dispatch] = useReducer(suggestionsReducer, SUGGESTIONS_INITIAL);
  const [sousOnglet, setSousOnglet] = useState<'toutes' | 'a_etudier' | 'decisions'>('toutes');
  const [chargementPlus, setChargementPlus] = useState(false);
  const requete = useRef(0);


  const charger = useCallback(async () => {
    const id = ++requete.current;
    dispatch({ type: 'debut' });
    try {
      const res = await suggestionsApi.list(parametresSuggestions(agenceId, 0));
      if (id !== requete.current) return;
      const donnees = Array.isArray(res.data) ? res.data : [];
      dispatch({ type: 'succes', donnees, total: totalAnnonce(res.headers as Record<string, unknown>, donnees.length) });
    } catch {
      if (id === requete.current) dispatch({ type: 'echec' });
    }
  }, [agenceId]);

  useEffect(() => {
    charger();
    return () => { requete.current += 1; };
  }, [charger]);

  const chargerPlus = async () => {
    if (chargementPlus || etat.donnees.length >= etat.total) return;
    const id = requete.current;
    setChargementPlus(true);
    try {
      const res = await suggestionsApi.list(parametresSuggestions(agenceId, etat.donnees.length));
      if (id === requete.current) dispatch({ type: 'plus', donnees: Array.isArray(res.data) ? res.data : [] });
    } catch {
      if (id === requete.current) toast.show({ message: 'Impossible de charger les suggestions suivantes', tone: 'critical' });
    } finally {
      setChargementPlus(false);
    }
  };

  const changerStatut = async (id: string, statut: IdeaStatus) => {
    try {
      await suggestionsApi.updateStatut(id, statut);
      dispatch({ type: 'statut', id, statut });
      toast.show({ message: `Statut mis à jour : ${STATUS_LABELS[statut]}`, tone: 'success' });
    } catch {
      toast.show({ message: 'Impossible d’enregistrer la modification. Réessayez.', tone: 'critical' });
    }
  };

  return (
    <PilotageIdeasTab
      suggestions={etat.donnees}
      suggestionsTotal={etat.total}
      suggestionsLoading={etat.statut === 'chargement' && etat.donnees.length === 0}
      suggestionsError={etat.statut === 'erreur'}
      onRetrySuggestions={charger}
      suggestionsLoadingMore={chargementPlus}
      loadMoreSuggestions={chargerPlus}
      updateStatut={changerStatut}
      activeSubTab={sousOnglet}
      setActiveSubTab={setSousOnglet}
    />
  );
}

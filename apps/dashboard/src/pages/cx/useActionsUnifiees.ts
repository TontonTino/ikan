import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { feedbacksApi, issuesApi } from '../../services/api';
import type { ActionProbleme, Feedback } from '../../types';
import {
  TAILLE_PAGE_ACTIONS,
  interrogerLesAvis,
  interrogerLesProblemes,
  ligneDepuisAvis,
  ligneDepuisProbleme,
  parametresActionsProbleme,
  trierLignes,
  type FiltresActions,
  type LigneAction,
} from '../../utils/actionsUnifiees';

const nombre = (r: { headers?: Record<string, unknown> } | null | undefined): number => Number(r?.headers?.['x-total-count'] || 0);

/**
 * Liste unique des actions : les actions sur avis (`GET /feedbacks/`) et les actions de problème (`GET /issues/actions`), chargées ensemble et triées. Chaque source a son
 * propre total (en-tête X-Total-Count) et sa propre pagination ; « Charger plus » avance les deux. Une source en échec fait échouer la liste entière : jamais
 * « aucune action » à la place d'une erreur. `autreTotal` : total de l'autre segment (même filtres), pour l'afficher dans les segments.
 */
export function useActionsUnifiees(actif: boolean, filtres: FiltresActions, moiId: string | undefined) {
  const [avis, setAvis] = useState<Feedback[]>([]);
  const [problemes, setProblemes] = useState<ActionProbleme[]>([]);
  const [totaux, setTotaux] = useState({ avis: 0, problemes: 0, autre: 0 });
  const [chargement, setChargement] = useState(true);
  const [premierChargement, setPremierChargement] = useState(false);
  const [erreur, setErreur] = useState(false);
  const [chargementSuite, setChargementSuite] = useState(false);
  const ordre = useRef(0);

  const agence = filtres.agenceId ? { agence_id: filtres.agenceId } : {};
  const avisParams = (segment: 'en_cours' | 'terminees', offset: number, limit: number) => ({ avec_action: true, action_realisee: segment === 'terminees', limit, offset, ...agence });
  const autre = filtres.segment === 'en_cours' ? 'terminees' : 'en_cours';
  // « En retard » ne concerne que « En cours » : le total de « Terminées » se compte sans lui (avis compris).
  const filtresAutre: FiltresActions = autre === 'terminees' ? { ...filtres, enRetard: false } : filtres;

  const charger = useCallback(async () => {
    const mon = ++ordre.current;
    setChargement(true);
    setErreur(false);
    try {
      const [a, p, a2, p2] = await Promise.all([
        interrogerLesAvis(filtres) ? feedbacksApi.list(avisParams(filtres.segment, 0, TAILLE_PAGE_ACTIONS)) : null,
        interrogerLesProblemes(filtres) ? issuesApi.listActions(parametresActionsProbleme(filtres, moiId, 0)) : null,
        interrogerLesAvis(filtresAutre) ? feedbacksApi.list(avisParams(autre, 0, 1)) : null,
        interrogerLesProblemes(filtresAutre) ? issuesApi.listActions(parametresActionsProbleme(filtresAutre, moiId, 0, 1, autre)) : null,
      ]);
      if (mon !== ordre.current) return;                                          // une réponse plus ancienne que la dernière demande est ignorée
      setAvis(a?.data || []);
      setProblemes(p?.data || []);
      setTotaux({ avis: nombre(a), problemes: nombre(p), autre: nombre(a2) + nombre(p2) });
    } catch (err) {
      if (mon !== ordre.current) return;
      console.error('Erreur chargement des actions:', err);
      setAvis([]);
      setProblemes([]);
      setErreur(true);
    } finally {
      if (mon === ordre.current) {
        setChargement(false);
        setPremierChargement(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filtres), moiId]);

  useEffect(() => {
    if (actif) void charger();
  }, [actif, charger]);

  const chargerSuite = useCallback(async () => {
    if (chargementSuite) return;
    setChargementSuite(true);
    try {
      const [a, p] = await Promise.all([
        interrogerLesAvis(filtres) && avis.length < totaux.avis ? feedbacksApi.list(avisParams(filtres.segment, avis.length, TAILLE_PAGE_ACTIONS)) : null,
        interrogerLesProblemes(filtres) && problemes.length < totaux.problemes ? issuesApi.listActions(parametresActionsProbleme(filtres, moiId, problemes.length)) : null,
      ]);
      if (a) setAvis((cur) => [...cur, ...(a.data || [])]);
      if (p) setProblemes((cur) => [...cur, ...(p.data || [])]);
      return undefined;
    } catch {
      return 'echec';
    } finally {
      setChargementSuite(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargementSuite, avis.length, problemes.length, totaux.avis, totaux.problemes, JSON.stringify(filtres), moiId]);

  const lignes: LigneAction[] = useMemo(
    () => trierLignes([...avis.map(ligneDepuisAvis), ...problemes.map(ligneDepuisProbleme)], filtres.segment),
    [avis, problemes, filtres.segment],
  );
  const total = totaux.avis + totaux.problemes;
  return { lignes, total, autreTotal: totaux.autre, chargement, premierChargement, erreur, chargementSuite, partiel: lignes.length < total, recharger: charger, chargerSuite };
}

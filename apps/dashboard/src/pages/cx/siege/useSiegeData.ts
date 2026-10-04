import { useCallback, useEffect, useState } from 'react';
import { agencesApi, alertesApi, feedbacksApi, issuesApi, statisticsApi } from '../../../services/api';
import type { Agence, Alerte, Issue, StatsCXResponse } from '../../../types';
import { ISSUE_STATUTS_OUVERTS } from './siegeData';

/** État d'une source : chaque bloc du dashboard gère son propre chargement / erreur. */
export type Source<T> = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

const total = (headers: Record<string, unknown> | undefined) => Number(headers?.['x-total-count'] ?? 0);

export interface IssuesOuvertes {
  items: Issue[];
  /** Total réel côté API (somme des X-Total-Count par statut ouvert). */
  total: number;
  /** true si la liste récupérée est tronquée (limite 200 par statut). */
  tronquee: boolean;
}

export interface ActionsTotaux {
  enCours: number;
  realisees: number;
}

const ISSUES_LIMIT = 200; // maximum accepté par GET /issues/

/** Issues ouvertes (3 statuts), éventuellement pour une seule agence. */
export async function fetchIssuesOuvertes(agenceId?: string): Promise<IssuesOuvertes> {
  const res = await Promise.all(
    ISSUE_STATUTS_OUVERTS.map((statut) => issuesApi.list({ statut, limit: ISSUES_LIMIT, ...(agenceId ? { agence_id: agenceId } : {}) })),
  );
  const items = res.flatMap((r) => r.data ?? []);
  const t = res.reduce((s, r) => s + total(r.headers as Record<string, unknown>), 0);
  return { items, total: Math.max(t, items.length), tronquee: t > items.length };
}

/**
 * Totaux des actions portées par les feedbacks (seule liste globale disponible).
 * Non filtrés par période : l'API ne filtre que sur la date de soumission du feedback.
 */
export async function fetchActionsTotaux(agenceId?: string): Promise<ActionsTotaux> {
  const scope = agenceId ? { agence_id: agenceId } : {};
  const [enCours, realisees] = await Promise.all([
    feedbacksApi.list({ avec_action: true, action_realisee: false, limit: 1, ...scope }),
    feedbacksApi.list({ avec_action: true, action_realisee: true, limit: 1, ...scope }),
  ]);
  return { enCours: total(enCours.headers as Record<string, unknown>), realisees: total(realisees.headers as Record<string, unknown>) };
}

function useSource<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<Source<T>>({ status: 'loading' });
  const [token, setToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Lors d'un rechargement, les données précédentes restent affichées (pas de saut de layout).
    setState((prev) => (prev.status === 'ok' ? prev : { status: 'loading' }));
    load()
      .then((data) => { if (!cancelled) setState({ status: 'ok', data }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, token]);
  const reload = useCallback(() => setToken((t) => t + 1), []);
  return [state, reload] as const;
}

export function useSiegeData(jours: number) {
  const [stats, reloadStats] = useSource<StatsCXResponse>(async () => (await statisticsApi.cx({ jours })).data, [jours]);
  const [alertes, reloadAlertes] = useSource<Alerte[]>(async () => (await alertesApi.list()).data?.alertes_seuil ?? [], []);
  const [agences, reloadAgences] = useSource<Agence[]>(async () => {
    const r = await agencesApi.list();
    return Array.isArray(r.data) ? r.data : [];
  }, []);
  const [issues, reloadIssues] = useSource<IssuesOuvertes>(() => fetchIssuesOuvertes(), []);
  const [actions, reloadActions] = useSource<ActionsTotaux>(() => fetchActionsTotaux(), []);

  const reloadAll = useCallback(() => {
    reloadStats();
    reloadAlertes();
    reloadAgences();
    reloadIssues();
    reloadActions();
  }, [reloadStats, reloadAlertes, reloadAgences, reloadIssues, reloadActions]);

  return { stats, alertes, agences, issues, actions, reloadStats, reloadIssues, reloadActions, reloadAll };
}
